import { describe, expect, test } from 'bun:test';
import { shouldAutoCompactBeforeOverflow } from '../packages/server/src/runtime/message/compaction-limits.ts';

describe('shouldAutoCompactBeforeOverflow', () => {
	test('triggers when configured threshold is reached', () => {
		expect(
			shouldAutoCompactBeforeOverflow({
				autoCompactThresholdTokens: 200_000,
				currentContextTokens: 190_000,
				estimatedInputTokens: 15_000,
			}),
		).toBe(true);
	});

	test('treats the configured threshold as an explicit context cap', () => {
		expect(
			shouldAutoCompactBeforeOverflow({
				autoCompactThresholdTokens: 200_000,
				currentContextTokens: 190_000,
				estimatedInputTokens: 15_000,
			}),
		).toBe(true);

		expect(
			shouldAutoCompactBeforeOverflow({
				autoCompactThresholdTokens: 200_000,
				currentContextTokens: 210_000,
			}),
		).toBe(true);
	});

	test('does not trigger for manual compact commands or compaction retries', () => {
		expect(
			shouldAutoCompactBeforeOverflow({
				autoCompactThresholdTokens: 200_000,
				currentContextTokens: 210_000,
				isCompactCommand: true,
			}),
		).toBe(false);

		expect(
			shouldAutoCompactBeforeOverflow({
				autoCompactThresholdTokens: 200_000,
				currentContextTokens: 210_000,
				compactionRetries: 1,
			}),
		).toBe(false);
	});
});
