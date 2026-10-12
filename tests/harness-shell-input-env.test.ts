import { expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
	getAugmentedPath,
	getShellEnvironment,
	getShellExecutionConfig,
	getShellExecutionConfigAsync,
	getShellEnvironmentAsync,
} from '../packages/sdk/src/core/src/tools/bin-manager.ts';
import { getTerminalExecutableInput } from '../packages/sdk/src/core/src/tools/builtin/terminal.ts';

test('terminal guard text includes args and executable writes', () => {
	expect(
		getTerminalExecutableInput({
			operation: 'start',
			command: 'sh',
			args: ['-c', 'rm -rf /'],
		}),
	).toBe("sh -c 'rm -rf /'");
	expect(
		getTerminalExecutableInput({ operation: 'write', input: 'rm -rf /\n' }),
	).toBe('rm -rf /\n');
	expect(getTerminalExecutableInput({ operation: 'read' })).toBeUndefined();
});
test('synchronous environment getters never launch discovery', async () => {
	const root = await mkdtemp(join(tmpdir(), 'harness-env-sync-'));
	const shell = join(root, 'shell');
	const marker = join(root, 'calls');
	const previous = process.env.SHELL;
	try {
		await writeFile(
			shell,
			`#!/bin/sh\necho call >> '${marker}'\nexec /bin/sh "$@"\n`,
		);
		await chmod(shell, 0o755);
		process.env.SHELL = shell;
		getAugmentedPath();
		getShellEnvironment();
		getShellEnvironment({ envMode: 'login-fresh' });
		getShellExecutionConfig('true', { envMode: 'login-fresh' });
		await Bun.sleep(100);
		await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
		await getShellEnvironmentAsync();
		expect(await readFile(marker, 'utf8')).toBe('call\n');
		getAugmentedPath();
		getShellEnvironment({ envMode: 'login-fresh' });
		await Bun.sleep(100);
		expect(await readFile(marker, 'utf8')).toBe('call\n');
	} finally {
		if (previous === undefined) delete process.env.SHELL;
		else process.env.SHELL = previous;
		await rm(root, { recursive: true, force: true });
	}
});
test('shell environment discovery is async, single-flight, and caches failures', async () => {
	const root = await mkdtemp(join(tmpdir(), 'harness-env-'));
	const shell = join(root, 'shell');
	const marker = join(root, 'calls');
	const previous = process.env.SHELL;
	try {
		await writeFile(
			shell,
			`#!/bin/sh\necho call >> '${marker}'\nsleep 0.1\nexit 1\n`,
		);
		await chmod(shell, 0o755);
		process.env.SHELL = shell;
		let timerRan = false;
		const timer = setTimeout(() => {
			timerRan = true;
		}, 0);
		await Promise.all([
			getShellExecutionConfigAsync('true'),
			getShellExecutionConfigAsync('true'),
		]);
		clearTimeout(timer);
		expect(timerRan).toBe(true);
		await getShellExecutionConfigAsync('true');
		expect(await readFile(marker, 'utf8')).toBe('call\n');
	} finally {
		if (previous === undefined) delete process.env.SHELL;
		else process.env.SHELL = previous;
		await rm(root, { recursive: true, force: true });
	}
});
test('async first-use environment includes executables added by the user shell', async () => {
	const root = await mkdtemp(join(tmpdir(), 'harness-env-first-'));
	const shell = join(root, 'shell');
	const loginBin = join(root, 'login-bin');
	const previousShell = process.env.SHELL;
	const previousPath = process.env.PATH;
	const marker = join(root, 'calls');
	try {
		await writeFile(
			shell,
			`#!/bin/sh\necho call >> '${marker}'\nexport PATH='${loginBin}':$PATH\nexport SYNTHETIC_LOGIN_VALUE=loaded\nexec /bin/sh "$@"\n`,
		);
		await chmod(shell, 0o755);
		process.env.SHELL = shell;
		process.env.PATH = '/usr/bin:/bin';
		const env = await getShellEnvironmentAsync({ envMode: 'login-fresh' });
		expect(env.PATH.split(delimiter)).toContain(loginBin);
		const minimal = getShellEnvironment({ envMode: 'minimal' });
		expect(minimal.PATH.split(delimiter)).toContain(loginBin);
		expect(minimal.SYNTHETIC_LOGIN_VALUE).toBeUndefined();
		expect((await getShellEnvironmentAsync({ envMode: 'minimal' })).PATH).toBe(
			minimal.PATH,
		);
		expect(await readFile(marker, 'utf8')).toBe('call\n');
	} finally {
		if (previousShell === undefined) delete process.env.SHELL;
		else process.env.SHELL = previousShell;
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		await rm(root, { recursive: true, force: true });
	}
});
