import { describe, expect, test } from 'bun:test';
import { resolveTerminalEnvironment } from '../packages/sdk/src/core/src/terminals/manager';

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
});
