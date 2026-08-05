import { basename } from 'node:path';
import Ajv, { type ErrorObject } from 'ajv';
import {
	NATIVE_EXTENSION_PROTOCOL_VERSION,
	type NativeExtensionCallRequest,
	type NativeExtensionOutputFrame,
} from './protocol.ts';

const PASSTHROUGH_ENV_KEYS = [
	'PATH',
	'HOME',
	'USERPROFILE',
	'TMPDIR',
	'TEMP',
	'TMP',
	'LANG',
	'LC_ALL',
	'SYSTEMROOT',
] as const;

const ajv = new Ajv({ allErrors: true, strict: false });

export type ExecuteNativeExtensionOptions = {
	entryPath: string;
	pluginDir: string;
	projectRoot: string;
	storagePath: string;
	toolName: string;
	input: Record<string, unknown>;
	secrets: Record<string, string>;
	outputSchema?: Record<string, unknown>;
	timeoutMs: number;
	signal?: AbortSignal;
};

type StreamChunk = { delta: string; channel: string } | { result: unknown };

type PendingCall = {
	stream: AsyncQueue<StreamChunk>;
	timeout: ReturnType<typeof setTimeout>;
	onAbort?: () => void;
	signal?: AbortSignal;
	outputSchema?: Record<string, unknown>;
};

class AsyncQueue<T> implements AsyncIterable<T> {
	private values: T[] = [];
	private waiters: Array<{
		resolve: (value: IteratorResult<T>) => void;
		reject: (error: unknown) => void;
	}> = [];
	private finished = false;
	private failure: unknown;

	push(value: T): void {
		if (this.finished) return;
		const waiter = this.waiters.shift();
		if (waiter) waiter.resolve({ done: false, value });
		else this.values.push(value);
	}

	end(): void {
		if (this.finished) return;
		this.finished = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter.resolve({ done: true, value: undefined });
		}
	}

	fail(error: unknown): void {
		if (this.finished) return;
		this.finished = true;
		this.failure = error;
		for (const waiter of this.waiters.splice(0)) waiter.reject(error);
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				const value = this.values.shift();
				if (value !== undefined) return Promise.resolve({ done: false, value });
				if (this.failure) return Promise.reject(this.failure);
				if (this.finished)
					return Promise.resolve({ done: true, value: undefined });
				return new Promise((resolve, reject) => {
					this.waiters.push({ resolve, reject });
				});
			},
		};
	}
}

function buildHostEnvironment(): Record<string, string> {
	const env: Record<string, string> = { OTTO_NATIVE_EXTENSION_HOST: '1' };
	for (const key of PASSTHROUGH_ENV_KEYS) {
		const value = process.env[key];
		if (value) env[key] = value;
	}
	return env;
}

function resolveHostCommand(): string[] {
	const override = process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY?.trim();
	if (override) return [process.execPath, override, '__extension-host'];

	const executableName = basename(process.execPath).toLowerCase();
	if (executableName === 'bun' || executableName === 'bun.exe') {
		const cliEntry = process.argv[1];
		if (cliEntry && /\.[cm]?[jt]sx?$/.test(cliEntry)) {
			return [process.execPath, cliEntry, '__extension-host'];
		}
		throw new Error(
			'Cannot locate the Otto CLI entry for the native extension host',
		);
	}

	return [process.execPath, '__extension-host'];
}

function formatValidationErrors(
	errors: ErrorObject[] | null | undefined,
): string {
	return (errors ?? [])
		.map(
			(error) =>
				`${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
		)
		.join('; ');
}

function validateOutput(
	value: unknown,
	schema: Record<string, unknown> | undefined,
): void {
	if (!schema) return;
	const validate = ajv.compile(schema);
	if (validate(value)) return;
	throw new Error(
		`Native extension result failed outputSchema: ${formatValidationErrors(validate.errors)}`,
	);
}

async function readFrames(
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line) onLine(line);
				newline = buffer.indexOf('\n');
			}
		}
		const final = `${buffer}${decoder.decode()}`.trim();
		if (final) onLine(final);
	} finally {
		reader.releaseLock();
	}
}

class NativeExtensionHost {
	private subprocess: ReturnType<typeof Bun.spawn>;
	private pending = new Map<string, PendingCall>();
	private closed = false;

	constructor(private readonly key: string) {
		this.subprocess = Bun.spawn(resolveHostCommand(), {
			env: buildHostEnvironment(),
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const stdout = this.subprocess.stdout;
		const stderr = this.subprocess.stderr;
		if (!stdout || typeof stdout === 'number') {
			throw new Error('Native extension host stdout is unavailable');
		}
		void readFrames(stdout, (line) => this.handleLine(line)).catch((error) =>
			this.dispose(error),
		);
		if (stderr && typeof stderr !== 'number') {
			void new Response(stderr).text().then((output) => {
				if (output.trim() && !this.closed) process.stderr.write(output);
			});
		}
		void this.subprocess.exited.then((exitCode) => {
			if (!this.closed) {
				this.dispose(
					new Error(`Native extension host exited with code ${exitCode}`),
				);
			}
		});
	}

	call(options: ExecuteNativeExtensionOptions): AsyncIterable<StreamChunk> {
		if (this.closed) throw new Error('Native extension host is closed');
		const id = crypto.randomUUID();
		const stream = new AsyncQueue<StreamChunk>();
		const timeout = setTimeout(() => {
			this.dispose(
				new Error(`Native extension timed out after ${options.timeoutMs}ms`),
			);
		}, options.timeoutMs);
		const pending: PendingCall = {
			stream,
			timeout,
			signal: options.signal,
			outputSchema: options.outputSchema,
		};
		if (options.signal) {
			pending.onAbort = () =>
				this.dispose(new Error('Native extension call aborted'));
			if (options.signal.aborted) {
				clearTimeout(timeout);
				stream.fail(new Error('Native extension call aborted'));
				return stream;
			}
			options.signal.addEventListener('abort', pending.onAbort, { once: true });
		}
		this.pending.set(id, pending);
		const request: NativeExtensionCallRequest = {
			protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
			entryPath: options.entryPath,
			pluginDir: options.pluginDir,
			projectRoot: options.projectRoot,
			storagePath: options.storagePath,
			toolName: options.toolName,
			input: options.input,
			secrets: options.secrets,
		};
		this.write({ type: 'call', id, request });
		return stream;
	}

	private write(frame: unknown): void {
		const stdin = this.subprocess.stdin;
		if (!stdin || typeof stdin === 'number') {
			this.dispose(new Error('Native extension host stdin is unavailable'));
			return;
		}
		stdin.write(`${JSON.stringify(frame)}\n`);
	}

	private handleLine(line: string): void {
		let frame: NativeExtensionOutputFrame;
		try {
			frame = JSON.parse(line) as NativeExtensionOutputFrame;
		} catch {
			this.dispose(new Error('Native extension host returned invalid JSON'));
			return;
		}
		const pending = this.pending.get(frame.id);
		if (!pending) return;
		if (frame.type === 'event') {
			pending.stream.push(frame.event);
			return;
		}
		this.finishPending(frame.id, pending);
		if (!frame.response.ok) {
			const error = new Error(frame.response.error.message);
			error.name = frame.response.error.name;
			if (frame.response.error.stack) error.stack = frame.response.error.stack;
			pending.stream.fail(error);
			return;
		}
		try {
			validateOutput(frame.response.result, pending.outputSchema);
			pending.stream.push({ result: frame.response.result });
			pending.stream.end();
		} catch (error) {
			pending.stream.fail(error);
		}
	}

	private finishPending(id: string, pending: PendingCall): void {
		this.pending.delete(id);
		clearTimeout(pending.timeout);
		if (pending.onAbort) {
			pending.signal?.removeEventListener('abort', pending.onAbort);
		}
	}

	dispose(error = new Error('Native extension host closed')): void {
		if (this.closed) return;
		this.closed = true;
		this.subprocess.kill();
		for (const [id, pending] of this.pending) {
			this.finishPending(id, pending);
			pending.stream.fail(error);
		}
		hosts.delete(this.key);
	}
}

const hosts = new Map<string, NativeExtensionHost>();

function getHost(options: ExecuteNativeExtensionOptions): NativeExtensionHost {
	const key = `${options.projectRoot}\0${options.pluginDir}`;
	let host = hosts.get(key);
	if (!host) {
		host = new NativeExtensionHost(key);
		hosts.set(key, host);
	}
	return host;
}

export function executeNativeExtension(
	options: ExecuteNativeExtensionOptions,
): AsyncIterable<StreamChunk> {
	return getHost(options).call(options);
}

export function disposeNativeExtensionHosts(projectRoot?: string): void {
	for (const [key, host] of Array.from(hosts.entries())) {
		if (projectRoot && !key.startsWith(`${projectRoot}\0`)) continue;
		host.dispose();
	}
}
