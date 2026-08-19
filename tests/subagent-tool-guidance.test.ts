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
		expect(schema).toContain('confirmCancel');
		expect(schema).toContain('defaults to queue');
		expect(schema).toContain('active child run must be preempted');
		expect(schema).toContain('user explicitly asked to cancel');
		expect(schema).toContain('stop polling');
		expect(schema).toContain('limit');
	});

	test('keeps ownership, reuse, automatic delivery, and no-poll guidance', () => {
		const description = buildSubagentTool('/tmp/project', 'parent').tool
			.description;

		expect(description).toContain('fresh parallel work');
		expect(description).toContain('related continuation');
		expect(description).toContain('owned by the child');
		expect(description).toContain('do not inspect its files');
		expect(description).toContain('check Git');
		expect(description).toContain('never progress polling');
		expect(description).toContain('end the turn');
		expect(description).toContain('not stop the child');
		expect(description).toContain('context-window usage');
		expect(description).toContain('recent tool calls');
		expect(description).toContain('/compact');
	});

	test('refuses to stop a child without explicit cancellation confirmation', async () => {
		const execute = buildSubagentTool('/tmp/project', 'parent').tool.execute;
		expect(execute).toBeDefined();
		const result = await execute?.({
			action: 'stop',
			subagentId: 'child',
		});

		expect(result).toMatchObject({ ok: false });
		expect(JSON.stringify(result)).toContain('stop polling');
		expect(JSON.stringify(result)).toContain('confirmCancel=true');
	});

	test('keeps the delegation boundary in the shared base prompt', async () => {
		const base = await Bun.file('packages/sdk/src/prompts/src/base.txt').text();
		const normalized = base.toLowerCase();

		expect(normalized).toContain('stop working on that scope');
		expect(normalized).toContain('git');
		expect(normalized).toContain('stop polling');
		expect(normalized).toContain('never');
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
