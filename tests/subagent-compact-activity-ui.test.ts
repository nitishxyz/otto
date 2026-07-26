import { describe, expect, test } from 'bun:test';
import { getCompactActivityEntry } from '../packages/web-sdk/src/components/messages/compactActivity.ts';
import type { MessagePart } from '../packages/web-sdk/src/types/api.ts';

describe('subagent compact activity labels', () => {
	test('uses a neutral loading label until streamed arguments identify the action', () => {
		expect(getCompactActivityEntry(part())?.label).toBe('Managing sub-agent');
	});

	test.each([
		['delegate', 'Delegating to plan: inspect the project'],
		['list', 'Checking sub-agents'],
		['status', 'Checking sub-agent status'],
		['read', 'Reading sub-agent activity'],
		['message', 'Following up with sub-agent'],
		['compact', 'Compacting sub-agent context'],
		['retry', 'Retrying sub-agent'],
		['stop', 'Stopping sub-agent'],
	])('labels %s while the tool is running', (action, expected) => {
		const args: Record<string, unknown> = { action };
		if (action === 'delegate') {
			args.agent = 'plan';
			args.task = 'inspect the project';
		}
		expect(getCompactActivityEntry(part(args))?.label).toBe(expected);
	});
});

function part(args?: Record<string, unknown>): MessagePart {
	return {
		id: 'part-1',
		messageId: 'message-1',
		index: 0,
		stepIndex: 0,
		type: 'tool_call',
		content: JSON.stringify(
			args ? { name: 'subagent', args } : { name: 'subagent' },
		),
		contentJson: args ? { name: 'subagent', args } : { name: 'subagent' },
		agent: 'otto',
		provider: 'test',
		model: 'test',
		startedAt: Date.now(),
		completedAt: null,
		toolName: 'subagent',
		toolCallId: 'call-1',
		toolDurationMs: null,
	};
}
