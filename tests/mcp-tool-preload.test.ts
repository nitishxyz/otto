import { describe, expect, test } from 'bun:test';
import {
	JudgeClient,
	type JudgeFetch,
	type ResolvedJudgeConfig,
} from '../packages/sdk/src/judge/index.ts';
import {
	buildLoadMCPToolsTool,
	buildMCPToolCatalogDescription,
	type MCPToolBrief,
} from '../packages/sdk/src/core/src/mcp/lazy-tools.ts';
import { selectMCPToolsForRequest } from '../packages/sdk/src/core/src/mcp/preload.ts';

const judgeConfig: ResolvedJudgeConfig = {
	enabled: true,
	provider: 'typesafe',
	baseURL: 'https://judge.example',
	model: 'jev-test',
	apiKey: 'key',
	timeoutMs: 500,
	mcp: { classifyTools: true, preloadTools: true, preloadThreshold: 0.5 },
};

const briefs: MCPToolBrief[] = [
	{ name: 'gh__list_prs', server: 'gh', description: 'List pull requests' },
	{ name: 'gh__create_issue', server: 'gh', description: 'Create an issue' },
	{ name: 'slack__post', server: 'slack', description: 'Post a message' },
	{ name: 'db__query', server: 'db', description: 'Run a SQL query' },
];

function judgeWith(
	probabilitiesByName: Record<string, number>,
	onCall?: (body: Record<string, unknown>) => void,
): JudgeClient {
	const fetchImpl: JudgeFetch = async (_url, init) => {
		const body = JSON.parse(String(init.body)) as {
			state: { request: string; tools: Array<{ name: string }> };
			questions: Record<string, unknown>;
		};
		onCall?.(body);
		const answers: Record<string, unknown> = {};
		body.state.tools.forEach((tool, index) => {
			answers[`tool_${index}`] = {
				type: 'noul',
				noul: probabilitiesByName[tool.name] ?? 0,
			};
		});
		return new Response(JSON.stringify({ answers }), { status: 200 });
	};
	return new JudgeClient(judgeConfig, fetchImpl);
}

describe('MCP tool preload selection', () => {
	test('selects tools above threshold, highest first, and sends one question per tool', async () => {
		let questionCount = 0;
		let request = '';
		const judge = judgeWith(
			{ gh__list_prs: 0.94, gh__create_issue: 0.61, slack__post: 0.03 },
			(body) => {
				questionCount = Object.keys(
					body.questions as Record<string, unknown>,
				).length;
				request = (body.state as { request: string }).request;
			},
		);
		const result = await selectMCPToolsForRequest(
			{ userMessage: 'check my open PRs', briefs },
			{ judge, threshold: 0.5 },
		);
		expect(request).toBe('check my open PRs');
		expect(questionCount).toBe(briefs.length);
		expect(result.selected).toEqual(['gh__list_prs', 'gh__create_issue']);
		expect(result.probabilities.slack__post).toBe(0.03);
		expect(result.skipped).toBeNull();
	});

	test('skips already-loaded tools and respects maxTools', async () => {
		let candidateNames: string[] = [];
		const judge = judgeWith(
			{ gh__create_issue: 0.9, slack__post: 0.8, db__query: 0.7 },
			(body) => {
				candidateNames = (
					body.state as { tools: Array<{ name: string }> }
				).tools.map((t) => t.name);
			},
		);
		const result = await selectMCPToolsForRequest(
			{
				userMessage: 'file an issue and tell the team',
				briefs,
				alreadyLoaded: new Set(['gh__list_prs']),
			},
			{ judge, threshold: 0.5, maxTools: 2 },
		);
		expect(candidateNames).not.toContain('gh__list_prs');
		expect(result.selected).toEqual(['gh__create_issue', 'slack__post']);
	});

	test('degrades cleanly on empty input or judge failure', async () => {
		const judge = judgeWith({});
		expect(
			(
				await selectMCPToolsForRequest(
					{ userMessage: '   ', briefs },
					{ judge, threshold: 0.5 },
				)
			).skipped,
		).toBe('empty-message');
		expect(
			(
				await selectMCPToolsForRequest(
					{ userMessage: 'hi', briefs: [] },
					{ judge, threshold: 0.5 },
				)
			).skipped,
		).toBe('no-candidates');

		const failing = new JudgeClient(
			judgeConfig,
			async () => new Response('down', { status: 500 }),
		);
		const failed = await selectMCPToolsForRequest(
			{ userMessage: 'hi', briefs },
			{ judge: failing, threshold: 0.5 },
		);
		expect(failed.selected).toEqual([]);
		expect(failed.skipped).toBe('judge-failed');
	});
});

describe('MCP tool catalog description', () => {
	test('default catalog is unchanged when nothing is preloaded', () => {
		const full = buildMCPToolCatalogDescription(briefs);
		expect(full).toContain('[gh]');
		expect(full).toContain('gh__list_prs: List pull requests');
		expect(full).toContain('slack__post: Post a message');
		expect(
			buildMCPToolCatalogDescription(briefs, { preloaded: new Set() }),
		).toBe(full);
	});

	test('compact catalog lists preloaded tools with descriptions and the rest by name', () => {
		const compact = buildMCPToolCatalogDescription(briefs, {
			preloaded: new Set(['gh__list_prs']),
		});
		expect(compact).toContain('Already loaded for this request');
		expect(compact).toContain('gh__list_prs: List pull requests');
		expect(compact).toContain('[slack] slack__post');
		expect(compact).not.toContain('Post a message');
		expect(compact.length).toBeLessThan(
			buildMCPToolCatalogDescription(briefs).length + 60,
		);
	});

	test('load_mcp_tools still validates every tool name in compact mode', async () => {
		const { tool } = buildLoadMCPToolsTool(briefs, {
			preloaded: new Set(['gh__list_prs']),
		});
		const execute = tool.execute as (
			input: { tools: string[] },
			opts: unknown,
		) => Promise<{ loaded: string[]; notFound?: string[] }>;
		const out = await execute(
			{ tools: ['slack__post', 'nope__x'] },
			{ toolCallId: 't', messages: [] },
		);
		expect(out.loaded).toEqual(['slack__post']);
		expect(out.notFound).toEqual(['nope__x']);
	});
});
