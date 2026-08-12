import { describe, expect, it } from 'bun:test';
import { enableLinuxShiftEnterReporting } from '../apps/tui/src/lib/terminal-keyboard.ts';

describe('TUI terminal keyboard setup', () => {
	it('enables modifyOtherKeys level 2 for Linux without Kitty keyboard', () => {
		const sequences: string[] = [];

		expect(
			enableLinuxShiftEnterReporting(
				{ kitty_keyboard: false },
				{ platform: 'linux', write: (sequence) => sequences.push(sequence) },
			),
		).toBe(true);
		expect(sequences).toEqual(['\x1b[>4;2m']);
	});

	it('leaves Kitty and non-Linux keyboard modes unchanged', () => {
		const sequences: string[] = [];
		const write = (sequence: string) => sequences.push(sequence);

		expect(
			enableLinuxShiftEnterReporting(
				{ kitty_keyboard: true },
				{ platform: 'linux', write },
			),
		).toBe(false);
		expect(
			enableLinuxShiftEnterReporting(
				{ kitty_keyboard: false },
				{ platform: 'darwin', write },
			),
		).toBe(false);
		expect(
			enableLinuxShiftEnterReporting(null, { platform: 'linux', write }),
		).toBe(false);
		expect(sequences).toEqual([]);
	});
});
