import { describe, expect, test } from 'bun:test';
import {
	buildDelegateTaskTool,
	buildListSubagentsTool,
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
});
