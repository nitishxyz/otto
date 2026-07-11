import { describe, expect, test } from 'bun:test';
import { collectRunningSessionTreeIds } from '../packages/server/src/runtime/session/working.ts';

describe('session working state', () => {
	test('marks every ancestor of a running nested sub-agent as running', () => {
		const runningIds = collectRunningSessionTreeIds(
			[
				{ id: 'child', parentSessionId: 'parent' },
				{ id: 'grandchild', parentSessionId: 'child' },
			],
			['grandchild'],
		);

		expect(runningIds).toEqual(new Set(['grandchild', 'child', 'parent']));
	});

	test('does not infer running state from persisted relationships alone', () => {
		const runningIds = collectRunningSessionTreeIds(
			[{ id: 'stale-child', parentSessionId: 'parent' }],
			[],
		);

		expect(runningIds.size).toBe(0);
	});

	test('stops safely when malformed parent relationships contain a cycle', () => {
		const runningIds = collectRunningSessionTreeIds(
			[
				{ id: 'first', parentSessionId: 'second' },
				{ id: 'second', parentSessionId: 'first' },
			],
			['first'],
		);

		expect(runningIds).toEqual(new Set(['first', 'second']));
	});
});
