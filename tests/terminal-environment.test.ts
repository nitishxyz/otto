import { describe, expect, test } from 'bun:test';
import {
	TerminalManager,
	resolveTerminalEnvironment,
} from '../packages/sdk/src/core/src/terminals/manager';

describe('terminal environment', () => {
	test('uses portable terminfo while advertising truecolor', () => {
		const environment = resolveTerminalEnvironment({
			env: { PATH: '/custom/bin', TERM: 'unsupported-terminal' },
			inheritEnv: false,
			augmentPath: false,
		});

		expect(environment.TERM).toBe('xterm-256color');
		expect(environment.COLORTERM).toBe('truecolor');
		expect(environment.TERM_PROGRAM).toBe('otto');
		expect(environment.PATH).toBe('/custom/bin');
	});
	test('native manager escalates SIGTERM when a PTY child ignores it', async () => {
		const manager = new TerminalManager();
		const terminal = manager.create({
			command: '/bin/sh',
			args: [
				'-c',
				"trap '' TERM; printf 'ready\\n'; while :; do sleep 1; done",
			],
			cwd: '/tmp',
			purpose: 'synthetic termination regression',
			createdBy: 'llm',
			inheritEnv: false,
			augmentPath: false,
			env: { PATH: '/usr/bin:/bin', HOME: '/tmp', SHELL: '/bin/sh' },
		});
		try {
			const deadline = Date.now() + 1000;
			while (
				!terminal.read().join('').includes('ready') &&
				Date.now() < deadline
			)
				await Bun.sleep(10);
			expect(terminal.read().join('')).toContain('ready');
			await manager.kill(terminal.id);
			expect(terminal.status).toBe('exited');
			expect(manager.get(terminal.id)).toBeUndefined();
			expect(() => process.kill(terminal.pid, 0)).toThrow();
		} finally {
			if (terminal.status !== 'exited') terminal.kill('SIGKILL');
			await manager.killAll();
		}
	});
});
