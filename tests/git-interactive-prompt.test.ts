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
import { runInteractiveGitCommand } from '../packages/server/src/routes/git/interactive.ts';
import { resolveSecureInput } from '../packages/server/src/runtime/tools/secure-input.ts';

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		unsetTerminalManager(dir);
		await rm(dir, { recursive: true, force: true });
	}
});

describe('interactive git command', () => {
	test('runs non-interactively without a session', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-git-no-session-'));
		tempDirs.push(projectRoot);
		const fakeGit = join(projectRoot, 'fake-git');
		await Bun.write(
			fakeGit,
			`#!/bin/sh
[ "$GIT_TERMINAL_PROMPT" = '0' ] || exit 21
[ -z "$GPG_TTY" ] || exit 22
printf 'non-interactive:ok\\n'
`,
		);
		await chmod(fakeGit, 0o755);

		const originalGpgTty = process.env.GPG_TTY;
		process.env.GPG_TTY = '/dev/wrong-daemon-terminal';
		try {
			const result = await runInteractiveGitCommand({
				projectRoot,
				cwd: projectRoot,
				gitArgs: ['push'],
				operation: 'push',
				gitCommand: fakeGit,
			});
			expect(result.stdout).toContain('non-interactive:ok');
		} finally {
			if (originalGpgTty === undefined) delete process.env.GPG_TTY;
			else process.env.GPG_TTY = originalGpgTty;
		}
	});

	test('surfaces a panel git prompt written to /dev/tty', async () => {
		if (process.platform === 'win32') return;
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-git-pty-'));
		tempDirs.push(projectRoot);
		const fakeGit = join(projectRoot, 'fake-git');
		await Bun.write(
			fakeGit,
			`#!/bin/sh
stty -echo < /dev/tty
printf 'Password: ' > /dev/tty
IFS= read -r secret < /dev/tty
stty echo < /dev/tty
[ "$secret" = 'panel-secret' ] && printf 'received:ok\\n'
`,
		);
		await chmod(fakeGit, 0o755);

		const terminalManager = new TerminalManager();
		setTerminalManager(terminalManager, projectRoot);
		const sessionId = crypto.randomUUID();
		let promptSeen = false;
		const unsubscribe = subscribe(
			sessionId,
			(event) => {
				if (event.type !== 'shell.secure_input.required') return;
				promptSeen = true;
				resolveSecureInput(
					String(event.payload?.promptId ?? ''),
					'panel-secret',
					projectRoot,
				);
			},
			projectRoot,
		);

		try {
			const result = await runInteractiveGitCommand({
				projectRoot,
				sessionId,
				cwd: projectRoot,
				gitArgs: ['push'],
				operation: 'push',
				gitCommand: fakeGit,
			});
			expect(promptSeen).toBe(true);
			expect(result.stdout).toContain('received:ok');
			expect(result.stdout).not.toContain('panel-secret');
		} finally {
			unsubscribe();
			await terminalManager.killAll();
		}
	});

	test('surfaces a signed commit passphrase and removes inherited GPG_TTY', async () => {
		if (process.platform === 'win32') return;
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-commit-pty-'));
		tempDirs.push(projectRoot);
		const fakeGit = join(projectRoot, 'fake-git-commit');
		await Bun.write(
			fakeGit,
			`#!/bin/sh
[ -z "$GPG_TTY" ] || exit 22
stty -echo < /dev/tty
printf 'Passphrase: ' > /dev/tty
IFS= read -r secret < /dev/tty
stty echo < /dev/tty
[ "$secret" = 'signing-secret' ] && printf 'commit:ok\\n'
`,
		);
		await chmod(fakeGit, 0o755);

		const terminalManager = new TerminalManager();
		setTerminalManager(terminalManager, projectRoot);
		const sessionId = crypto.randomUUID();
		const originalGpgTty = process.env.GPG_TTY;
		process.env.GPG_TTY = '/dev/wrong-daemon-terminal';
		const unsubscribe = subscribe(
			sessionId,
			(event) => {
				if (event.type !== 'shell.secure_input.required') return;
				resolveSecureInput(
					String(event.payload?.promptId ?? ''),
					'signing-secret',
					projectRoot,
				);
			},
			projectRoot,
		);

		try {
			const result = await runInteractiveGitCommand({
				projectRoot,
				sessionId,
				cwd: projectRoot,
				gitArgs: ['commit', '-m', 'test'],
				operation: 'commit',
				gitCommand: fakeGit,
			});
			expect(result.stdout).toContain('commit:ok');
			expect(result.stdout).not.toContain('signing-secret');
		} finally {
			if (originalGpgTty === undefined) delete process.env.GPG_TTY;
			else process.env.GPG_TTY = originalGpgTty;
			unsubscribe();
			await terminalManager.killAll();
		}
	});
});
