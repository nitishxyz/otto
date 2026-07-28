import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCompactActivityEntry } from '../packages/web-sdk/src/components/messages/compactActivity.ts';
import { ToolResultRenderer } from '../packages/web-sdk/src/components/messages/renderers/index.tsx';
import type { MessagePart } from '../packages/web-sdk/src/types/api.ts';

describe('subagent message UI', () => {
	test('renders follow-up as unified asynchronous subagent activity', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="subagent"
				contentJson={{
					args: {
						action: 'message',
						subagentId: 'subagent-1',
						message: 'Continue with verification',
					},
					result: {
						ok: true,
						subagentId: 'subagent-1',
						childSessionId: 'child-session-1',
						agent: 'plan',
						status: 'running',
					},
				}}
				toolDurationMs={12}
			/>,
		);

		expect(markup).toContain('subagent');
		expect(markup).toContain('Continue with verification');
		expect(markup).toContain('async');
		expect(markup).not.toContain('child-session-1');
	});

	test('uses a clear compact activity label', () => {
		expect(
			getCompactActivityEntry(toolCallPart('Continue with verification'))
				?.label,
		).toBe('Following up with sub-agent: Continue with verification');
	});
});

function toolCallPart(message: string): MessagePart {
	return {
		id: 'part-1',
		messageId: 'message-1',
		index: 0,
		stepIndex: 0,
		type: 'tool_call',
		content: JSON.stringify({
			name: 'subagent',
			args: { action: 'message', subagentId: 'subagent-1', message },
		}),
		contentJson: {
			name: 'subagent',
			args: { action: 'message', subagentId: 'subagent-1', message },
		},
		agent: 'looper',
		provider: 'test',
		model: 'test',
		startedAt: Date.now(),
		completedAt: null,
		toolName: 'subagent',
		toolCallId: 'call-1',
		toolDurationMs: null,
	};
}
