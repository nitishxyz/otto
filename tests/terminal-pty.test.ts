import { describe, expect, it } from 'bun:test';
import { spawn } from '../packages/sdk/src/core/src/terminals/bun-pty.ts';

describe('built-in terminal adapter', () => {
	it('streams terminal output and reports the process exit code', async () => {
		const output: string[] = [];
		const pty = spawn(
			process.execPath,
			['-e', 'process.stdout.write("native-pty-ok")'],
			{
				cwd: process.cwd(),
				cols: 80,
				rows: 24,
				env: { ...process.env } as Record<string, string>,
			},
		);

		pty.onData((data) => output.push(data));
		const exitCode = await new Promise<number>((resolve) => {
			pty.onExit((event) => resolve(event.exitCode));
		});

		expect(exitCode).toBe(0);
		expect(output.join('')).toContain('native-pty-ok');
	});
	it('queues early writes and resize while preserving synthetic environment', async () => {
		const output: string[] = [];
		const pty = spawn(
			'/bin/sh',
			[
				'-c',
				'read reply; stty size; printf "reply:%s env:%s" "$reply" "$SYNTHETIC_VALUE"',
			],
			{
				cwd: '/tmp',
				cols: 80,
				rows: 24,
				env: {
					PATH: '/usr/bin:/bin',
					HOME: '/tmp',
					SYNTHETIC_VALUE: 'value with spaces',
				},
			},
		);
		pty.onData((data) => output.push(data));
		pty.resize(91, 33);
		pty.write('synthetic-input\r');
		try {
			const exitCode = await new Promise<number>((resolve) =>
				pty.onExit((event) => resolve(event.exitCode)),
			);
			expect(exitCode).toBe(0);
			expect(output.join('')).toContain('33 91');
			expect(output.join('')).toContain(
				'reply:synthetic-input env:value with spaces',
			);
		} finally {
			pty.kill('SIGKILL');
		}
	});
});
