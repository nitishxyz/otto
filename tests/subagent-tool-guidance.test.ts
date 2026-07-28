import { describe, expect, test } from 'bun:test';
import { asSchema } from 'ai';
import {
	buildSubagentTool,
	buildSubagentTools,
} from '../packages/server/src/tools/subagents/index.ts';
import { defaultToolConfigForAgent } from '../packages/server/src/runtime/agent/registry/tools.ts';

describe('subagent tool guidance', () => {
	test('registers one lifecycle tool', () => {
		const tools = buildSubagentTools('/tmp/project', 'parent');
		expect(tools).toHaveLength(1);
		expect(tools[0]?.name).toBe('subagent');
	});

	test('exposes all lifecycle actions in one compact schema', () => {
		const item = buildSubagentTool('/tmp/project', 'parent');
		const schema = JSON.stringify(asSchema(item.tool.inputSchema).jsonSchema);

		for (const action of [
			'delegate',
			'list',
			'status',
			'read',
			'message',
			'compact',
			'stop',
			'retry',
		]) {
			expect(schema).toContain(`"${action}"`);
		}
		expect(schema).toContain('reuseSessionId');
		expect(schema).toContain('subagentId');
		expect(schema).toContain('delivery');
		expect(schema).toContain('limit');
	});

	test('keeps ownership, reuse, automatic delivery, and no-poll guidance', () => {
		const description = buildSubagentTool('/tmp/project', 'parent').tool
			.description;

		expect(description).toContain('fresh parallel work');
		expect(description).toContain('related continuation');
		expect(description).toContain('owned by the child');
		expect(description).toContain('message marks the child active');
		expect(description).toContain('delivered automatically when ready');
		expect(description).toContain('must not sleep');
		expect(description).toContain('repeatedly call list, status, or read');
		expect(description).toContain('end the turn instead');
		expect(description).toContain('context-window usage');
		expect(description).toContain('recent tool calls');
		expect(description).toContain('/compact');
	});

	test('uses the unified subagent tool for looper follow-ups', async () => {
		const looperTools = defaultToolConfigForAgent('looper');
		const prompt = await Bun.file(
			'packages/sdk/src/prompts/src/agents/looper.txt',
		).text();

		expect(looperTools.firstClass).not.toContain('enqueue_session_message');
		expect(prompt).not.toContain('enqueue_session_message');
		expect(prompt).toContain('subagent` action=`message');
		expect(prompt).toContain('marks the sub-agent active again');
		expect(prompt).toContain('result returns automatically');
	});
});
