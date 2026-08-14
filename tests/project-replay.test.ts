import { describe, expect, test } from 'bun:test';
import {
	getProjectReplay,
	MAX_REPLAY_BYTES_PER_KEY,
	MAX_REPLAY_EVENTS_PER_KEY,
	recordProjectSessionEvent,
} from '../packages/server/src/events/project-replay.ts';

describe('project event replay ring', () => {
	test('bounds retained events by count and encoded bytes', () => {
		const countProject = `/tmp/replay-count-${crypto.randomUUID()}`;
		for (let index = 0; index < MAX_REPLAY_EVENTS_PER_KEY + 50; index += 1) {
			recordProjectSessionEvent({
				type: 'message.part.delta',
				sessionId: 'count-session',
				projectRoot: countProject,
				payload: { index, delta: 'small' },
			});
		}
		const countReplay = getProjectReplay([countProject], '0');
		expect(countReplay.missed).toBe(true);
		expect(countReplay.records).toHaveLength(MAX_REPLAY_EVENTS_PER_KEY);

		const bytesProject = `/tmp/replay-bytes-${crypto.randomUUID()}`;
		for (let index = 0; index < 100; index += 1) {
			recordProjectSessionEvent({
				type: 'tool.result',
				sessionId: 'bytes-session',
				projectRoot: bytesProject,
				payload: { index, result: 'x'.repeat(200_000) },
			});
		}
		const bytesReplay = getProjectReplay([bytesProject], '0');
		const retainedBytes = bytesReplay.records.reduce(
			(total, record) => total + record.chunk.byteLength,
			0,
		);
		expect(bytesReplay.missed).toBe(true);
		expect(retainedBytes).toBeLessThanOrEqual(MAX_REPLAY_BYTES_PER_KEY);
	});
});
