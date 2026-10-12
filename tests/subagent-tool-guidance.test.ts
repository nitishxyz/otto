import { describe, expect, test } from 'bun:test';
import { asSchema } from 'ai';
import {
	buildSubagentTool,
	buildSubagentTools,
} from '../packages/server/src/tools/subagents/index.ts';
import { MAX_CONCURRENT_PER_PARENT } from '../packages/server/src/runtime/subagents/types.ts';
import {
	buildSubagentPrompt,
	buildSubagentResultsPrompt,
} from '../packages/server/src/runtime/subagents/prompt.ts';

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

	test('keeps coordination and the delegation boundary in the coordinator prompt', async () => {
		const prompt = await Bun.file(
			'packages/sdk/src/prompts/src/coordinator.txt',
		).text();
		const normalized = prompt.toLowerCase();

		expect(normalized).toContain('sub-agents cannot delegate');
		expect(normalized).toContain('up to 10 at once');
		expect(normalized).toContain('review/test pass');
		expect(normalized).toContain('300k');

		const base = await Bun.file('packages/sdk/src/prompts/src/base.txt').text();
		expect(base.toLowerCase()).not.toContain('delegated work');
	});

	test('allows up to 10 concurrent sub-agents', () => {
		expect(MAX_CONCURRENT_PER_PARENT).toBe(10);
	});

	test('tells sub-agents to implement without delegating or test loops', () => {
		const prompt = buildSubagentPrompt({
			parentSessionId: 'parent',
			parentAgent: 'build',
			task: 'Do it',
		});
		expect(prompt).toContain('You cannot delegate');
		expect(prompt).toContain('Do not run broad test suites');
	});

	test('reports child context usage and flags compaction over 300k', () => {
		const prompt = buildSubagentResultsPrompt([
			{
				id: 'a',
				agent: 'build',
				status: 'completed',
				task: 't',
				summary: 'ok',
				contextTokens: 120_000,
			},
			{
				id: 'b',
				agent: 'build',
				status: 'completed',
				task: 't',
				summary: 'ok',
				contextTokens: 340_000,
			},
		]);
		expect(prompt).toContain('- a (build): 120k context tokens\n');
		expect(prompt).toContain('- b (build): 340k context tokens (over 300k');
	});
});
