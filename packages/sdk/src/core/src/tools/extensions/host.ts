import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import type {
	NativeToolContext,
	NativeToolHandler,
	NativeToolModule,
	NativeToolProcessOptions,
	NativeToolProcessResult,
} from '../../../../tool-extension.ts';
import {
	NATIVE_EXTENSION_PROTOCOL_VERSION,
	type NativeExtensionRequest,
	type NativeExtensionResponse,
} from './protocol.ts';

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
	const stdoutPromise = new Response(subprocess.stdout).text();
	const stderrPromise = new Response(subprocess.stderr).text();
	const exitCode = await subprocess.exited;
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	if (exitCode !== 0 && !options.allowNonZeroExit) {
		const detail =
			stderr.trim() || stdout.trim() || `${options.command} failed`;
		throw new Error(
			`${options.command} exited with code ${exitCode}: ${detail}`,
		);
	}
	return { exitCode, stdout, stderr };
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

async function executeRequest(
	request: NativeExtensionRequest,
): Promise<unknown> {
	if (request.protocolVersion !== NATIVE_EXTENSION_PROTOCOL_VERSION) {
		throw new Error(
			`Unsupported native extension protocol: ${request.protocolVersion}`,
		);
	}
	const entryPath = resolveWithinRoot(request.pluginDir, request.entryPath);
	const module = (await import(
		`${pathToFileURL(entryPath).href}?call=${crypto.randomUUID()}`
	)) as Record<string, unknown>;
	const handler = resolveHandler(module);
	const controller = new AbortController();
	const context: NativeToolContext = {
		protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
		projectRoot: request.projectRoot,
		pluginDir: request.pluginDir,
		toolName: request.toolName,
		signal: controller.signal,
		workspace: createWorkspaceContext(request.projectRoot),
		process: {
			run: (options) => runProcess(request.projectRoot, options),
		},
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

export async function runNativeExtensionHost(): Promise<void> {
	redirectExtensionConsoleToStderr();
	let response: NativeExtensionResponse;
	try {
		const raw = await Bun.stdin.text();
		const request = JSON.parse(raw) as NativeExtensionRequest;
		const result = await executeRequest(request);
		response = {
			protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
			ok: true,
			result: result ?? { ok: true },
		};
	} catch (error) {
		response = errorResponse(error);
	}
	process.stdout.write(`${JSON.stringify(response)}\n`);
}
