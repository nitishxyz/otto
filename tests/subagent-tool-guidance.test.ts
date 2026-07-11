import { describe, expect, test } from 'bun:test';
import {
	buildDelegateTaskTool,
	buildListSubagentsTool,
	buildMessageSubagentTool,
	buildStopSubagentTool,
} from '../packages/server/src/tools/subagents/index.ts';

describe('subagent tool guidance', () => {
	test('tells parent agents to end their turn instead of polling', () => {
		const delegateDescription = buildDelegateTaskTool('/tmp/project', 'parent')
			.tool.description;
		const listDescription = buildListSubagentsTool('/tmp/project', 'parent')
			.tool.description;

		expect(delegateDescription).toContain('Do not poll for completion');
		expect(delegateDescription).toContain('end the current turn');
		expect(listDescription).toContain('not to poll a running sub-agent');
		expect(listDescription).toContain('do not check again in this turn');
	});

	test('explains same-agent parallel delegation versus session reuse', () => {
		const delegateDescription = buildDelegateTaskTool('/tmp/project', 'parent')
			.tool.description;

		expect(delegateDescription).toContain(
			'multiple instances of the same agent type',
		);
		expect(delegateDescription).toContain('two separate plan delegations');
		expect(delegateDescription).toContain('only for related continuation work');
	});

	test('explains queued and interrupt follow-ups plus explicit stopping', () => {
		const messageDescription = buildMessageSubagentTool(
			'/tmp/project',
			'parent',
		).tool.description;
		const stopDescription = buildStopSubagentTool('/tmp/project', 'parent').tool
			.description;

		expect(messageDescription).toContain('delivery="queue"');
		expect(messageDescription).toContain('delivery="interrupt"');
		expect(messageDescription).toContain('silently stops the current turn');
		expect(stopDescription).toContain('clears queued follow-ups');
		expect(stopDescription).toContain('marks it cancelled');
	});
});
