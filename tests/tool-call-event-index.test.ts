import { describe, expect, it } from 'bun:test';
import { subscribe } from '../packages/server/src/events/bus.ts';
import { publishToolCall } from '../packages/server/src/tools/adapter/events.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';

describe('tool call stream ordering', () => {
	it('publishes the persisted part index for the ephemeral renderer', () => {
		const sessionId = crypto.randomUUID();
		let payload: Record<string, unknown> | undefined;
		const unsubscribe = subscribe(sessionId, (event) => {
			if (event.type === 'tool.call') {
				payload = event.payload as Record<string, unknown>;
			}
		});

		try {
			publishToolCall(
				{
					sessionId,
					messageId: 'assistant-1',
				} as ToolAdapterContext,
				{
					name: 'apply_patch',
					input: { patch: '*** Begin Patch' },
					callId: 'call-1',
					stepIndex: 2,
					index: 17,
				},
			);
			expect(payload?.index).toBe(17);
			expect(payload?.messageId).toBe('assistant-1');
		} finally {
			unsubscribe();
		}
	});
});
