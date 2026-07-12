import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
	STARTUP_MESSAGE_INTERVAL_MS,
	STARTUP_MESSAGES,
	nextStartupMessageIndex,
} from '../src/lib/startup-messages';

describe('startup messages', () => {
	test('sequence is playful but still signals startup', () => {
		expect(STARTUP_MESSAGES.length).toBeGreaterThanOrEqual(3);
		expect(STARTUP_MESSAGES[0].toLowerCase()).toContain('daemon');
		const joined = STARTUP_MESSAGES.join(' ').toLowerCase();
		expect(joined).toContain('workspace');
	});

	test('includes the preferred playful lines', () => {
		expect(STARTUP_MESSAGES).toContain('Summoning the daemon…');
		expect(STARTUP_MESSAGES).toContain('Firing things up…');
		expect(STARTUP_MESSAGES).toContain('Convincing electrons to cooperate…');
	});

	test('messages stay short and avoid technical internals', () => {
		const forbidden = [
			'localhost',
			'127.0.0.1',
			'port',
			'http',
			'sqlite',
			'token',
			'pid',
			'socket',
		];
		for (const message of STARTUP_MESSAGES) {
			expect(message.length).toBeLessThanOrEqual(48);
			expect(message.endsWith('…')).toBe(true);
			const lower = message.toLowerCase();
			for (const word of forbidden) {
				expect(lower).not.toContain(word);
			}
		}
	});

	test('rotation advances and holds on the final message', () => {
		const last = STARTUP_MESSAGES.length - 1;
		expect(nextStartupMessageIndex(0)).toBe(1);
		expect(nextStartupMessageIndex(last - 1)).toBe(last);
		expect(nextStartupMessageIndex(last)).toBe(last);
	});

	test('invalid indexes reset to the first message', () => {
		expect(nextStartupMessageIndex(-1)).toBe(0);
		expect(nextStartupMessageIndex(1.5)).toBe(0);
		expect(nextStartupMessageIndex(Number.NaN)).toBe(0);
	});

	test('interval is unhurried but not stale', () => {
		expect(STARTUP_MESSAGE_INTERVAL_MS).toBeGreaterThanOrEqual(1500);
		expect(STARTUP_MESSAGE_INTERVAL_MS).toBeLessThanOrEqual(5000);
	});

	test('hook cleans up timers and respects reduced motion', async () => {
		const hook = await readFile('src/hooks/useStartupMessage.ts', 'utf8');
		expect(hook).toContain('clearInterval');
		expect(hook).toContain('prefers-reduced-motion');
	});

	test('startup gate keeps the branded loader and calm announcements', async () => {
		const router = await readFile('src/router.tsx', 'utf8');
		expect(router).toContain('OttoRouterLoader');
		expect(router).toContain('useStartupMessage');
		expect(router).toContain('aria-hidden="true"');
	});
});
