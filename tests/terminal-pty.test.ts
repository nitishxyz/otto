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
});
