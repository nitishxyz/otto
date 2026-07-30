import { describe, expect, test } from 'bun:test';
import type { ClientEvent } from '../packages/server/src/events/types.ts';
import { subscribeClientEvents } from '../packages/server/src/events/bus.ts';
import {
	clearSessionAttention,
	requireSessionAttention,
	resolveSessionAttention,
	sessionNeedsAttention,
} from '../packages/server/src/runtime/session/attention.ts';
import {
	requestApproval,
	resolveApproval,
} from '../packages/server/src/runtime/tools/approval.ts';

describe('session attention', () => {
	test('publishes a notification and keeps attention until all input is resolved', () => {
		const sessionId = crypto.randomUUID();
		const projectRoot = `/tmp/${crypto.randomUUID()}`;
		const events: ClientEvent[] = [];
		const unsubscribe = subscribeClientEvents((event) => events.push(event));

		try {
			requireSessionAttention({
				key: 'first',
				sessionId,
				projectRoot,
				title: 'Permission required',
				body: 'The agent wants to use shell.',
			});
			requireSessionAttention({
				key: 'second',
				sessionId,
				projectRoot,
				title: 'Input required',
			});

			expect(sessionNeedsAttention(sessionId, projectRoot)).toBe(true);
			expect(
				events.filter(
					(event) =>
						event.type === 'session.status' &&
						event.payload.sessionId === sessionId &&
						event.payload.status === 'needs_attention',
				),
			).toHaveLength(2);
			expect(
				events.some(
					(event) =>
						event.type === 'notification' &&
						event.payload.sessionId === sessionId &&
						event.payload.title === 'Permission required',
				),
			).toBe(true);

			resolveSessionAttention({ key: 'first', sessionId, projectRoot });
			expect(sessionNeedsAttention(sessionId, projectRoot)).toBe(true);
			expect(
				events.some(
					(event) =>
						event.type === 'session.status' &&
						event.payload.sessionId === sessionId &&
						event.payload.status === 'running',
				),
			).toBe(false);

			resolveSessionAttention({ key: 'second', sessionId, projectRoot });
			expect(sessionNeedsAttention(sessionId, projectRoot)).toBe(false);
			expect(
				events.some(
					(event) =>
						event.type === 'session.status' &&
						event.payload.sessionId === sessionId &&
						event.payload.status === 'running',
				),
			).toBe(true);
		} finally {
			unsubscribe();
			clearSessionAttention(sessionId, projectRoot);
		}
	});

	test('tool approval requests notify clients and mark the session', async () => {
		const sessionId = crypto.randomUUID();
		const messageId = crypto.randomUUID();
		const callId = crypto.randomUUID();
		const projectRoot = `/tmp/${crypto.randomUUID()}`;
		const events: ClientEvent[] = [];
		const unsubscribe = subscribeClientEvents((event) => events.push(event));

		try {
			const result = requestApproval(
				sessionId,
				messageId,
				callId,
				'git_push',
				{},
				1_000,
				projectRoot,
			);

			expect(sessionNeedsAttention(sessionId, projectRoot)).toBe(true);
			expect(
				events.some(
					(event) =>
						event.type === 'notification' &&
						event.payload.sessionId === sessionId &&
						event.payload.title === 'Permission required' &&
						event.payload.body === 'The agent wants to use git push.',
				),
			).toBe(true);

			expect(resolveApproval(callId, true, projectRoot)).toEqual({ ok: true });
			expect(await result).toBe(true);
			expect(sessionNeedsAttention(sessionId, projectRoot)).toBe(false);
		} finally {
			unsubscribe();
			clearSessionAttention(sessionId, projectRoot);
		}
	});
});
