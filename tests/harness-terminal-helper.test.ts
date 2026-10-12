import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PTY_HELPER_SOURCE } from '../packages/sdk/src/core/src/terminals/pty-helper.ts';
import { spawnIsolatedPty } from '../packages/sdk/src/core/src/terminals/isolated-pty.ts';

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
async function waitUntil(
	predicate: () => boolean | Promise<boolean>,
	timeout = 2500,
) {
	const deadline = Date.now() + timeout;
	while (!(await predicate())) {
		if (Date.now() >= deadline)
			throw new Error('Synthetic fixture deadline exceeded');
		await Bun.sleep(10);
	}
}

for (const failure of [
	'parent loss',
	'oversized frame',
	'blocked output',
] as const) {
	test(`helper kills PTY descendants after ${failure}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-helper-tree-'));
		const marker = join(root, 'pids');
		const helper = spawn(
			process.execPath,
			['--no-env-file', '--eval', PTY_HELPER_SOURCE],
			{
				env: { BUN_BE_BUN: '1' },
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		);
		let exited = false;
		helper.on('exit', () => {
			exited = true;
		});
		helper.stdin.on('error', () => {});
		helper.stderr.resume();
		if (failure !== 'blocked output') helper.stdout.resume();
		let pids: number[] = [];
		try {
			helper.stdin.write(
				`${JSON.stringify({
					type: 'start',
					command: '/bin/sh',
					args: [
						'-c',
						`trap '' HUP TERM; sleep 90 & descendant=$!; printf '%s %s' $$ "$descendant" > '${marker}'; ${failure === 'blocked output' ? 'while :; do printf "%4096s" x; done' : 'wait'}`,
					],
					options: {
						cwd: root,
						env: { HOME: root, PATH: '/usr/bin:/bin' },
						cols: 80,
						rows: 24,
					},
				})}\n`,
			);
			await waitUntil(async () => {
				try {
					pids = (await readFile(marker, 'utf8')).trim().split(' ').map(Number);
					return pids.length === 2 && pids.every((pid) => pid > 0);
				} catch {
					return false;
				}
			});
			expect(pids.every(alive)).toBe(true);
			if (failure === 'parent loss') helper.stdin.end();
			else if (failure === 'oversized frame')
				helper.stdin.write('x'.repeat(1024 * 1024 + 1));
			await waitUntil(() => exited, failure === 'blocked output' ? 7000 : 2500);
			await waitUntil(() => pids.every((pid) => !alive(pid)));
			expect(pids.some(alive)).toBe(false);
		} finally {
			helper.stdin.end();
			try {
				pids = (await readFile(marker, 'utf8')).trim().split(' ').map(Number);
			} catch {}
			for (const pid of pids.filter(
				(pid) => Number.isSafeInteger(pid) && pid > 0,
			)) {
				try {
					process.kill(pid, 'SIGKILL');
				} catch {}
			}
			helper.kill('SIGKILL');
			await rm(root, { recursive: true, force: true });
		}
	}, 11000);
}

test('isolated transport rejects oversized control queues without retaining input', async () => {
	const pty = spawnIsolatedPty('/bin/sh', ['-c', 'sleep 90'], {
		cwd: '/tmp',
		env: { PATH: '/usr/bin:/bin' },
	});
	const exited = new Promise<number>((resolve) =>
		pty.onExit((event) => resolve(event.exitCode)),
	);
	try {
		pty.write('x'.repeat(4 * 1024 * 1024));
		expect(await exited).toBe(1);
	} finally {
		pty.kill('SIGKILL');
	}
});

test('startup gate preserves fast exits, argv, environment, and PTY leader PID', async () => {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), 'otto-helper-gate-')),
	);
	const literal = 'literal "$HOME"; $(exit 99)';
	try {
		for (let iteration = 0; iteration < 20; iteration++) {
			const pty = spawnIsolatedPty(
				'/bin/sh',
				[
					'-c',
					'if (: <&3) 2>/dev/null; then exit 99; fi; printf "%s|%s|%s|%s" "$$" "$PWD" "$HOME" "$1"; exit 7',
					'fixture',
					literal,
				],
				{ cwd: root, env: { HOME: root, PATH: '/usr/bin:/bin' } },
			);
			let output = '';
			pty.onData((data) => {
				output += data;
			});
			try {
				const code = await new Promise<number>((resolve) =>
					pty.onExit((event) => resolve(event.exitCode)),
				);
				expect(code).toBe(7);
				expect(output).toBe(`${pty.pid}|${root}|${root}|${literal}`);
			} finally {
				pty.kill('SIGKILL');
			}
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 10000);

test('PTY output resumes after backpressure without losing bytes', async () => {
	const pty = spawnIsolatedPty('/bin/sh', ['-c', 'head -c 524288 /dev/zero'], {
		cwd: '/tmp',
		env: { PATH: '/usr/bin:/bin' },
	});
	let bytes = 0;
	pty.onData((data) => {
		bytes += Buffer.byteLength(data);
	});
	try {
		const code = await new Promise<number>((resolve) =>
			pty.onExit((event) => resolve(event.exitCode)),
		);
		expect(code).toBe(0);
		expect(bytes).toBe(524288);
	} finally {
		pty.kill('SIGKILL');
	}
});
