import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	JudgeClient,
	type JudgeFetch,
	type ResolvedJudgeConfig,
} from '../packages/sdk/src/judge/index.ts';
import {
	classifyMCPTools,
	classificationToEffects,
	classifyFromAnnotations,
	mcpToolClassificationKey,
	type MCPToolClassificationInput,
} from '../packages/sdk/src/core/src/mcp/classify.ts';
import { convertMCPToolsToAISDK } from '../packages/sdk/src/core/src/mcp/tools.ts';
import type { MCPServerManager } from '../packages/sdk/src/core/src/mcp/server-manager.ts';
import { getToolMetadata } from '../packages/sdk/src/core/src/tools/metadata.ts';
import { requiresApproval } from '../packages/server/src/runtime/tools/approval.ts';

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
	);
});

async function tempCache(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'otto-mcp-classify-'));
	dirs.push(dir);
	return join(dir, 'nested', 'classifications.json');
}

const judgeConfig: ResolvedJudgeConfig = {
	enabled: true,
	provider: 'typesafe',
	baseURL: 'https://judge.example',
	model: 'jev-test',
	apiKey: 'key',
	timeoutMs: 500,
	mcp: { classifyTools: true, preloadTools: true, preloadThreshold: 0.5 },
};

function input(
	server: string,
	name: string,
	description: string,
	annotations?: MCPToolClassificationInput['tool']['annotations'],
): MCPToolClassificationInput {
	return {
		name: `${server}__${name}`,
		server,
		tool: {
			name,
			description,
			inputSchema: { type: 'object', properties: {} },
			...(annotations ? { annotations } : {}),
		},
	};
}

type JudgeAnswerSpec = {
	effect: string;
	confidence?: number;
	irreversible: number;
};

/** Build a fetch that answers by tool name, verifying batch shape. */
function judgeFor(
	answersByName: Record<string, JudgeAnswerSpec>,
	onCall?: (body: Record<string, unknown>) => void,
): JudgeClient {
	const fetchImpl: JudgeFetch = async (_url, init) => {
		const body = JSON.parse(String(init.body)) as {
			state: { tools: Array<{ server: string; name: string }> };
			questions: Record<string, unknown>;
		};
		onCall?.(body);
		const answers: Record<string, unknown> = {};
		body.state.tools.forEach((tool, index) => {
			const spec = answersByName[`${tool.server}__${tool.name}`];
			if (!spec) return;
			answers[`effect_${index}`] = {
				type: 'choice',
				choice: spec.effect,
				probabilities: { [spec.effect]: spec.confidence ?? 0.9 },
				confidence: spec.confidence ?? 0.9,
			};
			answers[`irreversible_${index}`] = {
				type: 'noul',
				noul: spec.irreversible,
			};
		});
		return new Response(JSON.stringify({ model: 'jev-test', answers }), {
			status: 200,
		});
	};
	return new JudgeClient(judgeConfig, fetchImpl);
}

describe('MCP tool classification', () => {
	test('annotations win without calling the judge', async () => {
		const readOnly = classifyFromAnnotations({
			name: 'list',
			inputSchema: {},
			annotations: { readOnlyHint: true },
		});
		expect(readOnly?.effect).toBe('read_only');
		expect(readOnly?.source).toBe('annotations');

		const destructive = classifyFromAnnotations({
			name: 'drop',
			inputSchema: {},
			annotations: { destructiveHint: true },
		});
		expect(destructive?.effect).toBe('destructive');

		expect(
			classifyFromAnnotations({ name: 'x', inputSchema: {} }),
		).toBeUndefined();

		let calls = 0;
		const judge = judgeFor({}, () => calls++);
		const result = await classifyMCPTools(
			[input('gh', 'list_issues', 'List issues', { readOnlyHint: true })],
			{ judge, cachePath: await tempCache() },
		);
		expect(result.get('gh__list_issues')?.effect).toBe('read_only');
		expect(calls).toBe(0);
	});

	test('judge classifies unannotated tools and policy escalates uncertainty', async () => {
		const judge = judgeFor({
			gh__list_prs: { effect: 'read_only', irreversible: 0.05 },
			gh__create_issue: { effect: 'external_write', irreversible: 0.2 },
			gh__delete_repo: { effect: 'external_write', irreversible: 0.95 },
			gh__vague: { effect: 'local_write', confidence: 0.3, irreversible: 0.1 },
		});
		const result = await classifyMCPTools(
			[
				input('gh', 'list_prs', 'List pull requests'),
				input('gh', 'create_issue', 'Create an issue'),
				input('gh', 'delete_repo', 'Delete a repository'),
				input('gh', 'vague', 'Do something'),
			],
			{ judge, cachePath: await tempCache() },
		);
		expect(result.get('gh__list_prs')?.effect).toBe('read_only');
		expect(result.get('gh__create_issue')?.effect).toBe('external_write');
		expect(result.get('gh__delete_repo')?.effect).toBe('destructive');
		expect(result.get('gh__vague')?.effect).toBe('external_write');
		expect(result.get('gh__list_prs')?.source).toBe('judge');
	});

	test('caches on disk keyed by tool contract and skips the judge on hit', async () => {
		const cachePath = await tempCache();
		let calls = 0;
		const judge = judgeFor(
			{ gh__search: { effect: 'read_only', irreversible: 0 } },
			() => calls++,
		);
		const first = await classifyMCPTools([input('gh', 'search', 'Search')], {
			judge,
			cachePath,
		});
		expect(first.get('gh__search')?.effect).toBe('read_only');
		expect(calls).toBe(1);

		const raw = JSON.parse(await readFile(cachePath, 'utf8'));
		expect(Object.keys(raw.entries)).toHaveLength(1);

		const second = await classifyMCPTools([input('gh', 'search', 'Search')], {
			judge,
			cachePath,
		});
		expect(second.get('gh__search')?.effect).toBe('read_only');
		expect(calls).toBe(1);

		// A changed description is a new contract -> re-judged.
		await classifyMCPTools([input('gh', 'search', 'Search and delete')], {
			judge,
			cachePath,
		});
		expect(calls).toBe(2);

		expect(mcpToolClassificationKey(input('gh', 'search', 'A'))).not.toBe(
			mcpToolClassificationKey(input('gh', 'search', 'B')),
		);
	});

	test('without a judge, unannotated tools are left unclassified', async () => {
		const result = await classifyMCPTools(
			[
				input('gh', 'list', 'List', { readOnlyHint: true }),
				input('gh', 'unknown', 'Unknown'),
			],
			{ judge: null, cachePath: await tempCache() },
		);
		expect(result.get('gh__list')?.effect).toBe('read_only');
		expect(result.has('gh__unknown')).toBe(false);
	});

	test('judge failure degrades to no classification', async () => {
		const judge = new JudgeClient(
			judgeConfig,
			async () => new Response('nope', { status: 500 }),
		);
		const result = await classifyMCPTools([input('gh', 'x', 'X')], {
			judge,
			cachePath: await tempCache(),
		});
		expect(result.size).toBe(0);
	});
});

describe('classification -> approval gating', () => {
	function fakeManager(tools: MCPToolClassificationInput[]): MCPServerManager {
		return {
			getTools: () => tools,
			callTool: async () => ({ ok: true }),
		} as unknown as MCPServerManager;
	}

	test('effects metadata drives requiresApproval in dangerous mode', () => {
		const tools = [
			input('gh', 'list_prs', 'List'),
			input('gh', 'delete_repo', 'Delete'),
			input('gh', 'unclassified', 'Mystery'),
		];
		const classifications = new Map([
			[
				'gh__list_prs',
				{
					effect: 'read_only' as const,
					irreversible: 0,
					confidence: 1,
					source: 'judge' as const,
					classifiedAt: 0,
				},
			],
			[
				'gh__delete_repo',
				{
					effect: 'destructive' as const,
					irreversible: 1,
					confidence: 1,
					source: 'judge' as const,
					classifiedAt: 0,
				},
			],
		]);
		const converted = convertMCPToolsToAISDK(
			fakeManager(tools),
			classifications,
		);
		const byName = new Map(converted.map((t) => [t.name, t.tool]));

		const listMeta = getToolMetadata(byName.get('gh__list_prs'));
		expect(listMeta?.source).toBe('mcp');
		expect(listMeta?.effects).toEqual(['workspace-read']);
		expect(
			requiresApproval('gh__list_prs', 'dangerous', {}, listMeta?.effects),
		).toBe(false);

		const deleteMeta = getToolMetadata(byName.get('gh__delete_repo'));
		expect(deleteMeta?.effects).toEqual(['external-write']);
		expect(
			requiresApproval('gh__delete_repo', 'dangerous', {}, deleteMeta?.effects),
		).toBe(true);

		// Unclassified keeps today's behavior: no effects, no prompt.
		const unknownMeta = getToolMetadata(byName.get('gh__unclassified'));
		expect(unknownMeta?.effects).toBeUndefined();
		expect(
			requiresApproval(
				'gh__unclassified',
				'dangerous',
				{},
				unknownMeta?.effects,
			),
		).toBe(false);

		// `all` mode: classified read-only MCP tools skip the prompt; everything
		// else (writes, unclassified MCP, built-ins) still asks.
		expect(requiresApproval('gh__list_prs', 'all', {}, listMeta?.effects)).toBe(
			false,
		);
		expect(
			requiresApproval('gh__delete_repo', 'all', {}, deleteMeta?.effects),
		).toBe(true);
		expect(
			requiresApproval('gh__unclassified', 'all', {}, unknownMeta?.effects),
		).toBe(true);
		expect(requiresApproval('read', 'all', {}, ['workspace-read'])).toBe(true);

		expect(
			classificationToEffects({
				effect: 'local_write',
				irreversible: 0,
				confidence: 1,
				source: 'judge',
				classifiedAt: 0,
			}),
		).toEqual(['workspace-write']);
	});
});
