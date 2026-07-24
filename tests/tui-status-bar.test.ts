import { describe, expect, test } from 'bun:test';
import { formatContextUsage } from '../apps/tui/src/components/StatusBar.tsx';

describe('TUI status bar context usage', () => {
	test('shows both current context tokens and percentage', () => {
		expect(formatContextUsage(12_345, 37.6)).toBe('ctx 12.3K · 38%');
	});

	test('shows token count when a percentage is unavailable', () => {
		expect(formatContextUsage(900, 0)).toBe('ctx 900');
	});
});
