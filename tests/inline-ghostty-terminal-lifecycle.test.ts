import { describe, expect, test } from 'bun:test';
import {
	calculateTerminalGridSize,
	syncInlineTerminalActivation,
} from '../packages/web-sdk/src/lib/inline-ghostty-terminal';

describe('inline Ghostty terminal lifecycle', () => {
	test('does not resize a hidden terminal to a destructive minimum grid', () => {
		expect(calculateTerminalGridSize(0, 0, 8, 16)).toBeNull();
		expect(calculateTerminalGridSize(8, 16, 8, 16)).toBeNull();
		expect(calculateTerminalGridSize(800, 400, 8, 16)).toEqual({
			cols: 100,
			rows: 25,
		});
	});

	test('fits and focuses active terminals, then blurs inactive terminals', () => {
		const calls: string[] = [];
		const terminal = {
			fit: () => calls.push('fit'),
			focus: () => calls.push('focus'),
			blur: () => calls.push('blur'),
		};

		syncInlineTerminalActivation(terminal, true);
		syncInlineTerminalActivation(terminal, false);

		expect(calls).toEqual(['fit', 'focus', 'blur']);
	});
});
