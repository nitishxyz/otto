import { describe, expect, test } from 'bun:test';
import {
	shouldAutoCompactBeforeOverflow,
	shouldStopTurnForAutoCompact,
} from '../packages/server/src/runtime/message/compaction-limits.ts';

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

describe('shouldStopTurnForAutoCompact', () => {
	test('stops the turn when the last step crosses the threshold', () => {
		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: 200_000,
				lastStepUsage: { inputTokens: 198_000, outputTokens: 3_000 },
			}),
		).toBe(true);
	});

	test('keeps streaming while under the threshold', () => {
		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: 200_000,
				lastStepUsage: { inputTokens: 150_000, outputTokens: 2_000 },
			}),
		).toBe(false);
	});

	test('ignores steps without usable usage', () => {
		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: 200_000,
				lastStepUsage: null,
			}),
		).toBe(false);

		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: 200_000,
				lastStepUsage: { inputTokens: 0, outputTokens: 500_000 },
			}),
		).toBe(false);
	});

	test('does not stop for manual compacts, retries, or missing threshold', () => {
		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: 200_000,
				isCompactCommand: true,
				lastStepUsage: { inputTokens: 210_000 },
			}),
		).toBe(false);

		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: 200_000,
				compactionRetries: 1,
				lastStepUsage: { inputTokens: 210_000 },
			}),
		).toBe(false);

		expect(
			shouldStopTurnForAutoCompact({
				autoCompactThresholdTokens: null,
				lastStepUsage: { inputTokens: 210_000 },
			}),
		).toBe(false);
	});
});
