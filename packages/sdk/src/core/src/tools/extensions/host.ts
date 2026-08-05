import { createInterface } from 'node:readline';
import { dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type {
	NativeToolContentPart,
	NativeToolContext,
	NativeToolHandler,
	NativeToolModule,
	NativeToolProcessOptions,
	NativeToolProcessResult,
	NativeToolProgress,
} from '../../../../tool-extension.ts';
import {
	NATIVE_EXTENSION_PROTOCOL_VERSION,
	type NativeExtensionCallRequest,
	type NativeExtensionInputFrame,
	type NativeExtensionOutputFrame,
	type NativeExtensionResponse,
} from './protocol.ts';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const handlers = new Map<string, Promise<NativeToolHandler>>();
const activeCalls = new Map<string, AbortController>();

function resolveWithinRoot(root: string, target: string): string {
	const normalizedRoot = resolve(root);
	const resolved = resolve(normalizedRoot, target || '.');
	if (
		resolved !== normalizedRoot &&
		!resolved.startsWith(`${normalizedRoot}${sep}`)
	) {
		throw new Error(`Path escapes the allowed root: ${target}`);
	}
	return resolved;
}

function resolveHandler(module: Record<string, unknown>): NativeToolHandler {
	const candidate = (module.default ?? module.tool ?? module.plugin) as
		| NativeToolModule
		| undefined;
	if (typeof candidate === 'function') return candidate;
	if (
		candidate &&
		typeof candidate === 'object' &&
		typeof candidate.execute === 'function'
	) {
		return candidate.execute;
	}
	throw new Error(
		'Native tool entry must export a handler or { execute } object',
	);
}

function loadHandler(entryPath: string): Promise<NativeToolHandler> {
	let pending = handlers.get(entryPath);
	if (!pending) {
		pending = import(pathToFileURL(entryPath).href).then((module) =>
			resolveHandler(module as Record<string, unknown>),
		);
		handlers.set(entryPath, pending);
	}
	return pending;
}

function createWorkspaceContext(
	projectRoot: string,
): NativeToolContext['workspace'] {
	return {
		async readText(path) {
			return readFile(resolveWithinRoot(projectRoot, path), 'utf8');
		},
		async writeText(path, content) {
			const destination = resolveWithinRoot(projectRoot, path);
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, content, 'utf8');
		},
		async exists(path) {
			try {
				await access(resolveWithinRoot(projectRoot, path));
				return true;
			} catch {
				return false;
			}
		},
	};
}

async function runProcess(
	projectRoot: string,
	options: NativeToolProcessOptions,
	signal: AbortSignal,
): Promise<NativeToolProcessResult> {
	const cwd = resolveWithinRoot(projectRoot, options.cwd ?? '.');
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === 'string') env[key] = value;
	}
	for (const [key, value] of Object.entries(options.env ?? {}))
		env[key] = value;

	const subprocess = Bun.spawn([options.command, ...(options.args ?? [])], {
		cwd,
		env,
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const onAbort = () => subprocess.kill();
	if (signal.aborted) onAbort();
	else signal.addEventListener('abort', onAbort, { once: true });
	try {
		const stdoutPromise = new Response(subprocess.stdout).text();
		const stderrPromise = new Response(subprocess.stderr).text();
		const exitCode = await subprocess.exited;
		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
		if (signal.aborted) throw new Error('Native extension call aborted');
		if (exitCode !== 0 && !options.allowNonZeroExit) {
			const detail =
				stderr.trim() || stdout.trim() || `${options.command} failed`;
			throw new Error(
				`${options.command} exited with code ${exitCode}: ${detail}`,
			);
		}
		return { exitCode, stdout, stderr };
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

function assertStorageKey(key: string): void {
	if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) {
		throw new Error(
			'Storage keys must use letters, numbers, dot, dash, or underscore',
		);
	}
}

function storageFile(storagePath: string, key: string): string {
	assertStorageKey(key);
	return resolveWithinRoot(storagePath, `${key}.json`);
}

function createStorageContext(
	storagePath: string,
): NativeToolContext['storage'] {
	return {
		async get<T>(key: string): Promise<T | null> {
			try {
				return JSON.parse(
					await readFile(storageFile(storagePath, key), 'utf8'),
				) as T;
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return null;
				throw error;
			}
		},
		async set(key, value) {
			await mkdir(storagePath, { recursive: true });
			await writeFile(
				storageFile(storagePath, key),
				`${JSON.stringify(value, null, 2)}\n`,
				'utf8',
			);
		},
		async delete(key) {
			try {
				await rm(storageFile(storagePath, key));
				return true;
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return false;
				throw error;
			}
		},
	};
}

function inferMediaType(path: string): string {
	switch (extname(path).toLowerCase()) {
		case '.png':
			return 'image/png';
		case '.webp':
			return 'image/webp';
		case '.gif':
			return 'image/gif';
		default:
			return 'image/jpeg';
	}
}

function createOutputContext(projectRoot: string): NativeToolContext['output'] {
	return {
		async image(path, mediaType): Promise<NativeToolContentPart> {
			const data = await readFile(resolveWithinRoot(projectRoot, path));
			if (data.byteLength > MAX_IMAGE_BYTES) {
				throw new Error(`Image output exceeds ${MAX_IMAGE_BYTES} bytes`);
			}
			return {
				type: 'image',
				data: data.toString('base64'),
				mediaType: mediaType ?? inferMediaType(path),
			};
		},
	};
}

function writeFrame(frame: NativeExtensionOutputFrame): void {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
}

async function executeRequest(
	id: string,
	request: NativeExtensionCallRequest,
	controller: AbortController,
): Promise<unknown> {
	if (request.protocolVersion !== NATIVE_EXTENSION_PROTOCOL_VERSION) {
		throw new Error(
			`Unsupported native extension protocol: ${request.protocolVersion}`,
		);
	}
	const entryPath = resolveWithinRoot(request.pluginDir, request.entryPath);
	const handler = await loadHandler(entryPath);
	const context: NativeToolContext = {
		protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
		projectRoot: request.projectRoot,
		pluginDir: request.pluginDir,
		toolName: request.toolName,
		signal: controller.signal,
		workspace: createWorkspaceContext(request.projectRoot),
		process: {
			run: (options) =>
				runProcess(request.projectRoot, options, controller.signal),
		},
		progress(update: string | NativeToolProgress) {
			const normalized =
				typeof update === 'string' ? { message: update } : update;
			writeFrame({
				type: 'event',
				id,
				event: {
					channel: normalized.channel ?? 'progress',
					delta: normalized.message,
				},
			});
		},
		secrets: {
			get: (name) => request.secrets[name] ?? null,
		},
		storage: createStorageContext(request.storagePath),
		output: createOutputContext(request.projectRoot),
	};
	return handler(request.input, context);
}

function errorResponse(error: unknown): NativeExtensionResponse {
	const normalized = error instanceof Error ? error : new Error(String(error));
	return {
		protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
		ok: false,
		error: {
			name: normalized.name,
			message: normalized.message,
			...(normalized.stack ? { stack: normalized.stack } : {}),
		},
	};
}

function redirectExtensionConsoleToStderr(): void {
	const write = (...values: unknown[]) => {
		process.stderr.write(`${values.map(String).join(' ')}\n`);
	};
	console.log = write;
	console.info = write;
	console.debug = write;
	console.warn = write;
}

async function handleCall(
	id: string,
	request: NativeExtensionCallRequest,
): Promise<void> {
	const controller = new AbortController();
	activeCalls.set(id, controller);
	let response: NativeExtensionResponse;
	try {
		const result = await executeRequest(id, request, controller);
		response = {
			protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
			ok: true,
			result: result ?? { ok: true },
		};
	} catch (error) {
		response = errorResponse(error);
	} finally {
		activeCalls.delete(id);
	}
	writeFrame({ type: 'result', id, response });
}

function handleFrame(frame: NativeExtensionInputFrame): void {
	if (frame.type === 'cancel') {
		activeCalls.get(frame.id)?.abort();
		return;
	}
	void handleCall(frame.id, frame.request);
}

export async function runNativeExtensionHost(): Promise<void> {
	redirectExtensionConsoleToStderr();
	const lines = createInterface({
		input: process.stdin,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	for await (const line of lines) {
		if (!line.trim()) continue;
		try {
			handleFrame(JSON.parse(line) as NativeExtensionInputFrame);
		} catch (error) {
			process.stderr.write(
				`Invalid native extension protocol frame: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}
	for (const controller of activeCalls.values()) controller.abort();
}
