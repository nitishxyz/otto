import { describe, expect, test } from 'bun:test';
import { publish } from '../packages/server/src/events/bus.ts';
import { observeRunnerToolEvents } from '../packages/server/src/runtime/agent/runner/runner-tool-observer.ts';

describe('runner tool observer', () => {
	test('observes project-scoped tool events for its own assistant message only', () => {
		const sessionId = crypto.randomUUID();
		const projectRoot = `/tmp/harness-observer-${crypto.randomUUID()}`;
		const messageId = crypto.randomUUID();
		let toolCalls = 0;
		const observer = observeRunnerToolEvents({
			sessionId,
			projectRoot,
			messageId,
			dump: null,
			getStepIndex: () => 0,
			onToolCall: () => {
				toolCalls += 1;
			},
		});

		try {
			publish({
				type: 'tool.call',
				sessionId,
				projectRoot,
				payload: { name: 'read', callId: 'other', messageId: 'other-message' },
			});
			publish({
				type: 'tool.call',
				sessionId,
				projectRoot: '/tmp/some-other-project',
				payload: { name: 'read', callId: 'x', messageId },
			});
			publish({
				type: 'tool.result',
				sessionId,
				projectRoot,
				payload: { name: 'memory_context', callId: 'mem', messageId },
			});
			expect(observer.state.toolActivityObserved).toBe(false);
			expect(toolCalls).toBe(0);

			publish({
				type: 'tool.call',
				sessionId,
				projectRoot,
				payload: { name: 'shell', callId: 'call-1', messageId },
			});
			expect(observer.state.toolActivityObserved).toBe(true);
			expect(observer.state.lastToolName).toBe('shell');
			expect(toolCalls).toBe(1);
		} finally {
			observer.unsubscribe();
			observer.unsubscribe();
		}

		publish({
			type: 'tool.call',
			sessionId,
			projectRoot,
			payload: { name: 'write', callId: 'call-2', messageId },
		});
		expect(observer.state.lastToolName).toBe('shell');
	});
});
