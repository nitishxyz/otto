import { describe, expect, test } from 'bun:test';
import { shouldReturnFocusToInputOnKey } from '../packages/web-sdk/src/hooks/useKeyboardShortcuts';

describe('shouldReturnFocusToInputOnKey', () => {
	test('plain q while terminal is focused does not steal focus to chat', () => {
		expect(
			shouldReturnFocusToInputOnKey({
				key: 'q',
				isInInput: false,
				isInTerminal: true,
				currentFocus: 'viewer',
			}),
		).toBe(false);
	});

	test('plain q still returns to chat from non-terminal viewer focus', () => {
		expect(
			shouldReturnFocusToInputOnKey({
				key: 'q',
				isInInput: false,
				isInTerminal: false,
				currentFocus: 'viewer',
			}),
		).toBe(true);
	});

	test('plain q is ignored while typing in an input', () => {
		expect(
			shouldReturnFocusToInputOnKey({
				key: 'q',
				isInInput: true,
				isInTerminal: false,
				currentFocus: 'viewer',
			}),
		).toBe(false);
	});

	test('plain q returns to chat from sessions/git/rightPanel', () => {
		for (const currentFocus of ['sessions', 'git', 'rightPanel'] as const) {
			expect(
				shouldReturnFocusToInputOnKey({
					key: 'q',
					isInInput: false,
					isInTerminal: false,
					currentFocus,
				}),
			).toBe(true);
		}
	});

	test('Escape while terminal is focused does not return to chat', () => {
		expect(
			shouldReturnFocusToInputOnKey({
				key: 'Escape',
				isInInput: false,
				isInTerminal: true,
				currentFocus: 'viewer',
			}),
		).toBe(false);
	});

	test('Escape outside terminal returns to chat regardless of pane', () => {
		expect(
			shouldReturnFocusToInputOnKey({
				key: 'Escape',
				isInInput: false,
				isInTerminal: false,
				currentFocus: 'viewer',
			}),
		).toBe(true);
	});
});
