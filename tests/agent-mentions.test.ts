import { describe, expect, test } from 'bun:test';
import {
	buildExplicitAgentMentionContext,
	extractExplicitAgentMentions,
} from '../packages/server/src/runtime/prompt/agent-mentions.ts';

const agents = [
	{ name: 'build', description: 'Full coding agent' },
	{ name: 'plan', description: 'Read-only planner' },
	{ name: 'code-reviewer', description: 'Reviews diffs' },
	{ name: 'general' },
];

describe('agent mentions', () => {
	test('extracts known @agent mentions in order', () => {
		const result = extractExplicitAgentMentions(
			'hey @plan then @build please',
			agents,
		);
		expect(result.map((a) => a.name)).toEqual(['plan', 'build']);
	});

	test('dedupes repeated mentions', () => {
		const result = extractExplicitAgentMentions('@build and @build', agents);
		expect(result.map((a) => a.name)).toEqual(['build']);
	});

	test('ignores file-like mentions', () => {
		const result = extractExplicitAgentMentions(
			'check @src/build/index.ts and @README.md',
			agents,
		);
		expect(result).toEqual([]);
	});

	test('requires exact full-token match', () => {
		const result = extractExplicitAgentMentions(
			'@builder @planning @gen',
			agents,
		);
		expect(result).toEqual([]);
	});

	test('handles hyphenated names and trailing punctuation', () => {
		const result = extractExplicitAgentMentions(
			'ask @code-reviewer, then @plan.',
			agents,
		);
		expect(result.map((a) => a.name)).toEqual(['code-reviewer', 'plan']);
	});

	test('requires a boundary before @', () => {
		const result = extractExplicitAgentMentions('email@build.com', agents);
		expect(result).toEqual([]);
	});

	test('returns empty for content without @', () => {
		expect(extractExplicitAgentMentions('no mentions here', agents)).toEqual(
			[],
		);
	});

	test('builds delegation context for mentioned agents', () => {
		const context = buildExplicitAgentMentionContext({
			content: 'use @build for this',
			agents,
		});
		expect(context).toContain('<explicitly-mentioned-agents>');
		expect(context).toContain('- build: Full coding agent');
		expect(context).toContain('delegate_task');
	});

	test('returns empty context when nothing is mentioned', () => {
		const context = buildExplicitAgentMentionContext({
			content: 'plain message',
			agents,
		});
		expect(context).toBe('');
	});
});
