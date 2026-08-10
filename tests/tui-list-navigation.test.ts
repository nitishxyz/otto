import { describe, expect, test } from 'bun:test';
import {
	getListModalWindow,
	getVisibleWindow,
	isListDownKey,
	isListUpKey,
} from '../apps/tui/src/lib/list-navigation.ts';

describe('TUI list navigation keys', () => {
	test('accepts arrows and lowercase Vim keys', () => {
		expect(isListUpKey({ name: 'up' })).toBe(true);
		expect(isListUpKey({ name: 'k', raw: 'k' })).toBe(true);
		expect(isListDownKey({ name: 'down' })).toBe(true);
		expect(isListDownKey({ name: 'j', raw: 'j' })).toBe(true);
	});

	test('retains Ctrl+j/k and leaves shifted letters for text input', () => {
		expect(isListUpKey({ name: 'k', ctrl: true })).toBe(true);
		expect(isListDownKey({ name: 'j', ctrl: true })).toBe(true);
		expect(isListUpKey({ name: 'k', raw: 'K', shift: true })).toBe(false);
		expect(isListDownKey({ name: 'j', raw: 'J', shift: true })).toBe(false);
	});

	test('counts headers as physical rows when windowing grouped lists', () => {
		const rows = ['header', 'model', 'model', 'header', 'model', 'model'];
		const window = getVisibleWindow(rows.length, 4, 3);
		const visible = rows.slice(window.start, window.end);
		expect(visible).toHaveLength(3);
		expect(4).toBeGreaterThanOrEqual(window.start);
		expect(4).toBeLessThan(window.end);
	});

	test('fits list modals to content and caps them at a shared maximum', () => {
		expect(getListModalWindow(4, 2, 40)).toEqual({
			start: 0,
			end: 4,
			maxVisible: 16,
		});
		const capped = getListModalWindow(30, 25, 40);
		expect(capped.end - capped.start).toBe(16);
		expect(25).toBeGreaterThanOrEqual(capped.start);
		expect(25).toBeLessThan(capped.end);
	});

	test('reserves modal rows for search and summary controls', () => {
		const compact = getListModalWindow(20, 10, 20, 4);
		expect(compact.maxVisible).toBe(8);
		expect(compact.end - compact.start).toBe(8);
	});
});
