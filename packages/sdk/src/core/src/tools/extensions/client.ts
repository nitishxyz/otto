import { basename } from 'node:path';
import {
	NATIVE_EXTENSION_PROTOCOL_VERSION,
	type NativeExtensionRequest,
	type NativeExtensionResponse,
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

export type ExecuteNativeExtensionOptions = {
	entryPath: string;
	pluginDir: string;
	projectRoot: string;
	toolName: string;
	input: Record<string, unknown>;
	timeoutMs: number;
	signal?: AbortSignal;
};

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

function waitForExit(args: {
	subprocess: ReturnType<typeof Bun.spawn>;
	timeoutMs: number;
	signal?: AbortSignal;
}): Promise<number> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			args.signal?.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = () => {
			args.subprocess.kill();
			finish(() => reject(new Error('Native extension call aborted')));
		};
		const timeout = setTimeout(() => {
			args.subprocess.kill();
			finish(() =>
				reject(
					new Error(`Native extension timed out after ${args.timeoutMs}ms`),
				),
			);
		}, args.timeoutMs);

		if (args.signal?.aborted) {
			onAbort();
			return;
		}
		args.signal?.addEventListener('abort', onAbort, { once: true });
		args.subprocess.exited.then(
			(exitCode) => finish(() => resolve(exitCode)),
			(error) => finish(() => reject(error)),
		);
	});
}

export async function executeNativeExtension(
	options: ExecuteNativeExtensionOptions,
): Promise<unknown> {
	const request: NativeExtensionRequest = {
		protocolVersion: NATIVE_EXTENSION_PROTOCOL_VERSION,
		entryPath: options.entryPath,
		pluginDir: options.pluginDir,
		projectRoot: options.projectRoot,
		toolName: options.toolName,
		input: options.input,
	};
	const subprocess = Bun.spawn(resolveHostCommand(), {
		env: buildHostEnvironment(),
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const stdoutPromise = new Response(subprocess.stdout).text();
	const stderrPromise = new Response(subprocess.stderr).text();
	if (!subprocess.stdin || typeof subprocess.stdin === 'number') {
		subprocess.kill();
		throw new Error('Native extension host stdin is unavailable');
	}
	subprocess.stdin.write(JSON.stringify(request));
	subprocess.stdin.end();

	const exitCode = await waitForExit({
		subprocess,
		timeoutMs: options.timeoutMs,
		signal: options.signal,
	});
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	if (exitCode !== 0) {
		throw new Error(
			`Native extension host exited with code ${exitCode}: ${stderr.trim() || 'no error output'}`,
		);
	}

	let response: NativeExtensionResponse;
	try {
		response = JSON.parse(stdout) as NativeExtensionResponse;
	} catch {
		throw new Error(
			`Native extension host returned an invalid response${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
		);
	}
	if (response.protocolVersion !== NATIVE_EXTENSION_PROTOCOL_VERSION) {
		throw new Error(
			`Native extension host used unsupported protocol ${response.protocolVersion}`,
		);
	}
	if (!response.ok) {
		const error = new Error(response.error.message);
		error.name = response.error.name;
		if (response.error.stack) error.stack = response.error.stack;
		throw error;
	}
	return response.result;
}
