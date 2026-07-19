import { describe, expect, test } from 'bun:test';
import {
	emitDefaultsChange,
	mergeDefaultsChange,
	onDefaultsChange,
} from '../packages/web-sdk/src/lib/defaults-events';

describe('defaults change events', () => {
	test('notifies all active subscribers immediately', () => {
		const received: unknown[] = [];
		const unsubscribeFirst = onDefaultsChange((defaults) => {
			received.push(['first', defaults.theme]);
		});
		const unsubscribeSecond = onDefaultsChange((defaults) => {
			received.push(['second', defaults.theme]);
		});

		emitDefaultsChange({ theme: 'otto-light' });

		expect(received).toEqual([
			['first', 'otto-light'],
			['second', 'otto-light'],
		]);

		unsubscribeFirst();
		unsubscribeSecond();
	});

	test('stops notifying a removed subscriber', () => {
		let calls = 0;
		const unsubscribe = onDefaultsChange(() => {
			calls += 1;
		});

		unsubscribe();
		emitDefaultsChange({ theme: 'otto-dark' });

		expect(calls).toBe(0);
	});

	test('merges false preference values into each config cache', () => {
		const firstConfig = {
			defaults: { compactThread: true, theme: 'otto-dark' },
			providers: ['openai'],
		};
		const secondConfig = {
			defaults: { compactThread: true, theme: 'otto-dark' },
			providers: ['anthropic'],
		};

		expect(mergeDefaultsChange(firstConfig, { compactThread: false })).toEqual({
			defaults: { compactThread: false, theme: 'otto-dark' },
			providers: ['openai'],
		});
		expect(mergeDefaultsChange(secondConfig, { compactThread: false })).toEqual(
			{
				defaults: { compactThread: false, theme: 'otto-dark' },
				providers: ['anthropic'],
			},
		);
		expect(mergeDefaultsChange(firstConfig, { compactThread: true })).toBe(
			firstConfig,
		);
	});
});
