import { describe, expect, test } from 'bun:test';
import { asSchema } from 'ai';
import {
	buildSubagentTool,
	buildSubagentTools,
} from '../packages/server/src/tools/subagents/index.ts';

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
		expect(description).toContain('arrive automatically');
		expect(description).toContain('do not poll');
		expect(description).toContain('context-window usage');
		expect(description).toContain('recent tool calls');
		expect(description).toContain('/compact');
	});
});
