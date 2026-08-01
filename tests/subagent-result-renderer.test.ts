import { describe, expect, test } from 'bun:test';
import { buildSubagentResultsPrompt } from '../packages/server/src/runtime/subagents/prompt.ts';
import { parseSubagentResults } from '../packages/web-sdk/src/components/messages/SubagentResultsNotice';
import { summarizeSubagentResults } from '../packages/web-sdk/src/components/messages/renderers/SubagentResultRenderer';

describe('subagent_result inline renderer', () => {
	test('parseSubagentResults parses the server-built results prompt', () => {
		const prompt = buildSubagentResultsPrompt([
			{
				id: 'sa-1',
				agent: 'build',
				status: 'completed',
				task: 'Fix the header',
				summary: '## Result\n- Outcome: done',
			},
			{
				id: 'sa-2',
				agent: 'plan',
				status: 'failed',
				task: 'Investigate flaky test',
				summary: null,
			},
		]);

		const results = parseSubagentResults(prompt);
		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			id: 'sa-1',
			agent: 'build',
			status: 'completed',
			task: 'Fix the header',
		});
		expect(results[0]?.result).toContain('- Outcome: done');
		expect(results[1]).toMatchObject({
			id: 'sa-2',
			agent: 'plan',
			status: 'failed',
			task: 'Investigate flaky test',
		});
		expect(results[1]?.result).toBe('(no summary)');
		expect(prompt).toContain('source of truth');
		expect(prompt).toContain('do not inspect its files');
		expect(prompt).toContain('rerun commands');
		expect(prompt).toContain('rather than silently taking over');
	});

	test('summarizeSubagentResults for a single completed result', () => {
		const results = parseSubagentResults(
			buildSubagentResultsPrompt([
				{
					id: 'sa-1',
					agent: 'build',
					status: 'completed',
					task: 'Fix the header',
					summary: 'done',
				},
			]),
		);
		expect(summarizeSubagentResults(results)).toEqual({
			headline: 'build — Fix the header',
			failedCount: 0,
		});
	});

	test('summarizeSubagentResults counts failures across agents', () => {
		const results = parseSubagentResults(
			buildSubagentResultsPrompt([
				{
					id: 'sa-1',
					agent: 'build',
					status: 'completed',
					task: 'a',
					summary: 'ok',
				},
				{
					id: 'sa-2',
					agent: 'plan',
					status: 'failed',
					task: 'b',
					summary: null,
				},
			]),
		);
		expect(summarizeSubagentResults(results)).toEqual({
			headline: 'build, plan',
			failedCount: 1,
		});
	});

	test('summarizeSubagentResults handles empty input', () => {
		expect(summarizeSubagentResults([])).toEqual({
			headline: '',
			failedCount: 0,
		});
	});
});
