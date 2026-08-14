import { afterEach, describe, expect, test } from 'bun:test';
import {
	TerminalManager,
	setTerminalManager,
	unsetTerminalManager,
} from '@ottocode/sdk';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subscribe } from '../packages/server/src/events/bus.ts';
import { resolveSecureInput } from '../packages/server/src/runtime/tools/secure-input.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';
import { createSecureShellExecutor } from '../packages/server/src/tools/adapter/secure-shell.ts';

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

async function collectResult(stream: AsyncIterable<unknown>) {
	const chunks: unknown[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks.at(-1) as { result?: Record<string, unknown> };
}

afterEach(async () => {
	process.env.PATH = originalPath;
	for (const dir of tempDirs.splice(0)) {
		unsetTerminalManager(dir);
		await rm(dir, { recursive: true, force: true });
	}
});

describe('interactive shell PTY prompts', () => {
	test('surfaces a git prompt written directly to /dev/tty', async () => {
		if (process.platform === 'win32') return;
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-shell-pty-'));
		tempDirs.push(projectRoot);
		const fakeGit = join(projectRoot, 'git');
		await Bun.write(
			fakeGit,
			`#!/bin/sh
stty -echo < /dev/tty
printf 'Password: ' > /dev/tty
IFS= read -r secret < /dev/tty
stty echo < /dev/tty
[ "$secret" = 'test-secret' ] && printf 'received:ok\\n'
`,
		);
		await chmod(fakeGit, 0o755);
		process.env.PATH = `${projectRoot}:${originalPath ?? ''}`;

		const terminalManager = new TerminalManager();
		setTerminalManager(terminalManager, projectRoot);
		const sessionId = crypto.randomUUID();
		let promptSeen = false;
		const unsubscribe = subscribe(
			sessionId,
			(event) => {
				if (event.type !== 'shell.secure_input.required') return;
				const promptId = String(event.payload?.promptId ?? '');
				promptSeen = true;
				resolveSecureInput(promptId, 'test-secret', projectRoot);
			},
			projectRoot,
		);

		try {
			const executor = createSecureShellExecutor({
				ctx: {
					sessionId,
					messageId: crypto.randomUUID(),
					assistantPartId: crypto.randomUUID(),
					db: {} as ToolAdapterContext['db'],
					agent: 'build',
					provider: 'test',
					model: 'test',
					projectRoot,
					nextIndex: () => 0,
				},
			});
			const result = await collectResult(
				executor({
					cmd: './git push',
					cwd: projectRoot,
					allowNonZeroExit: false,
					timeout: 5_000,
					envMode: 'minimal',
					outputMode: 'full',
					tailLines: 100,
					maxOutputBytes: 10_000,
					detached: false,
				}) as AsyncIterable<unknown>,
			);

			expect(promptSeen).toBe(true);
			expect(result.result).toMatchObject({ ok: true, exitCode: 0 });
			expect(String(result.result?.stdout)).toContain('received:ok');
			expect(String(result.result?.stdout)).not.toContain('test-secret');
		} finally {
			unsubscribe();
			await terminalManager.killAll();
		}
	});

	test('submits a Linux SSH key passphrase with a terminal return', async () => {
		if (process.platform === 'win32') return;
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-shell-passphrase-'));
		tempDirs.push(projectRoot);
		const fakeGit = join(projectRoot, 'git');
		await Bun.write(
			fakeGit,
			`#!/bin/sh
stty -echo < /dev/tty
printf "Enter passphrase for key '/home/alice/.ssh/id_ed25519': " > /dev/tty
IFS= read -r secret < /dev/tty
stty echo < /dev/tty
[ "$secret" = 'linux-secret' ] && printf 'passphrase:ok\\n'
`,
		);
		await chmod(fakeGit, 0o755);
		process.env.PATH = `${projectRoot}:${originalPath ?? ''}`;

		const terminalManager = new TerminalManager();
		setTerminalManager(terminalManager, projectRoot);
		const sessionId = crypto.randomUUID();
		const unsubscribe = subscribe(
			sessionId,
			(event) => {
				if (event.type !== 'shell.secure_input.required') return;
				resolveSecureInput(
					String(event.payload?.promptId ?? ''),
					'linux-secret',
					projectRoot,
				);
			},
			projectRoot,
		);

		try {
			const executor = createSecureShellExecutor({
				ctx: {
					sessionId,
					messageId: crypto.randomUUID(),
					assistantPartId: crypto.randomUUID(),
					db: {} as ToolAdapterContext['db'],
					agent: 'build',
					provider: 'test',
					model: 'test',
					projectRoot,
					nextIndex: () => 0,
				},
			});
			const result = await collectResult(
				executor({
					cmd: './git pull',
					cwd: projectRoot,
					allowNonZeroExit: false,
					timeout: 5_000,
					envMode: 'minimal',
					outputMode: 'full',
					tailLines: 100,
					maxOutputBytes: 10_000,
					detached: false,
				}) as AsyncIterable<unknown>,
			);

			expect(result.result).toMatchObject({ ok: true, exitCode: 0 });
			expect(String(result.result?.stdout)).toContain('passphrase:ok');
			expect(String(result.result?.stdout)).not.toContain('linux-secret');
		} finally {
			unsubscribe();
			await terminalManager.killAll();
		}
	});

	test('cancels a PTY prompt once without reopening it', async () => {
		if (process.platform === 'win32') return;
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-shell-cancel-'));
		tempDirs.push(projectRoot);
		const fakeGit = join(projectRoot, 'git');
		await Bun.write(
			fakeGit,
			`#!/bin/sh
trap 'exit 130' INT TERM
stty -echo < /dev/tty
printf "Enter passphrase for /home/alice/.ssh/id_ed25519: " > /dev/tty
IFS= read -r secret < /dev/tty
stty echo < /dev/tty
`,
		);
		await chmod(fakeGit, 0o755);
		process.env.PATH = `${projectRoot}:${originalPath ?? ''}`;

		const terminalManager = new TerminalManager();
		setTerminalManager(terminalManager, projectRoot);
		const sessionId = crypto.randomUUID();
		let promptCount = 0;
		const unsubscribe = subscribe(
			sessionId,
			(event) => {
				if (event.type !== 'shell.secure_input.required') return;
				promptCount += 1;
				resolveSecureInput(
					String(event.payload?.promptId ?? ''),
					null,
					projectRoot,
				);
			},
			projectRoot,
		);

		try {
			const executor = createSecureShellExecutor({
				ctx: {
					sessionId,
					messageId: crypto.randomUUID(),
					assistantPartId: crypto.randomUUID(),
					db: {} as ToolAdapterContext['db'],
					agent: 'build',
					provider: 'test',
					model: 'test',
					projectRoot,
					nextIndex: () => 0,
				},
			});
			const result = await collectResult(
				executor({
					cmd: './git fetch',
					cwd: projectRoot,
					allowNonZeroExit: false,
					timeout: 5_000,
					envMode: 'minimal',
					outputMode: 'full',
					tailLines: 100,
					maxOutputBytes: 10_000,
					detached: false,
				}) as AsyncIterable<unknown>,
			);

			expect(promptCount).toBe(1);
			expect(result.result).toMatchObject({ ok: false, errorType: 'abort' });
		} finally {
			unsubscribe();
			await terminalManager.killAll();
		}
	});
});
