import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { loadConfig } from '@ottocode/sdk';
import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { setAuth } from '../packages/sdk/src/auth/src/index.ts';
import {
	createToolRegistrationMap,
	mapModelHistoryToolNames,
	registerRunnerTools,
} from '../packages/server/src/runtime/agent/runner/runner-tool-registration.ts';
import { setupLazyToolLoading } from '../packages/server/src/runtime/agent/runner/runner-lazy-tools.ts';
import type { SetupResult } from '../packages/server/src/runtime/agent/runner/runner-setup.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';
import {
	buildLazyPrepareStep,
	createLazyPrepareStepState,
	createLazyToolLoaderState,
} from '../packages/server/src/runtime/agent/lazy-prepare-step.ts';

const originalHome = process.env.HOME;
let root = '';
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-exact-registration-'));
	process.env.HOME = root;
	await setAuth('anthropic', {
		type: 'oauth',
		access: 'test-access',
		refresh: 'test-refresh',
		expires: Date.now() + 3_600_000,
	});
});
afterAll(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(root, { recursive: true, force: true });
});

const definition = tool({
	inputSchema: z.object({}),
	execute: async () => ({ ok: true }),
});
const ctx = { nextIndex: () => 0 } as ToolAdapterContext;

describe('exact runner tool registrations', () => {
	test('accepted PascalCase inverse preserves a__b and never reconstructs a_b', () => {
		const registration = createToolRegistrationMap();
		const adapted = registerRunnerTools({
			tools: [
				{ name: 'a__b', tool: definition },
				{ name: 'a_b', tool: definition },
			],
			ctx,
			provider: 'anthropic',
			authType: 'oauth',
			registration,
		});
		expect(Object.keys(adapted)).toEqual(['AB']);
		expect(registration.registrationToCanonical.AB).toBe('a__b');
		expect(registration.canonicalToRegistration.a_b).toBeUndefined();
		const history: ModelMessage[] = [
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'call',
						toolName: 'a__b',
						input: { text: 'a__b' },
					},
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call',
						toolName: 'a__b',
						output: { type: 'text', value: 'a__b' },
					},
				],
			},
		];
		const modelHistory = mapModelHistoryToolNames(
			history,
			registration.canonicalToRegistration,
		);
		expect(modelHistory).toEqual([
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'call',
						toolName: 'AB',
						input: { text: 'a__b' },
					},
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call',
						toolName: 'AB',
						output: { type: 'text', value: 'a__b' },
					},
				],
			},
		]);
		expect(
			mapModelHistoryToolNames(
				modelHistory,
				registration.registrationToCanonical,
			),
		).toEqual(history);
	});

	test('colliding tools cannot overwrite a registration in a later lazy/MCP batch', () => {
		const registration = createToolRegistrationMap();
		registerRunnerTools({
			tools: [{ name: 'a__b', tool: definition }],
			ctx,
			provider: 'anthropic',
			authType: 'oauth',
			registration,
		});
		const rejected = registerRunnerTools({
			tools: [{ name: 'a_b', tool: definition }],
			ctx,
			provider: 'anthropic',
			authType: 'oauth',
			registration,
		});
		expect(Object.keys(rejected)).toHaveLength(0);
		expect(registration.registrationToCanonical.AB).toBe('a__b');
		expect(registration.canonicalToRegistration.a_b).toBeUndefined();
	});

	test('canonical providers keep a__b and a_b distinct', () => {
		const registration = createToolRegistrationMap();
		const adapted = registerRunnerTools({
			tools: [
				{ name: 'a__b', tool: definition },
				{ name: 'a_b', tool: definition },
			],
			ctx,
			provider: 'openai',
			registration,
		});
		expect(Object.keys(adapted)).toEqual(['a__b', 'a_b']);
		expect(registration.registrationToCanonical.a__b).toBe('a__b');
		expect(registration.registrationToCanonical.a_b).toBe('a_b');
	});

	test('lazy results for rejected a_b cannot activate accepted a__b', async () => {
		const registration = createToolRegistrationMap();
		registerRunnerTools({
			tools: [
				{ name: 'a__b', tool: definition },
				{ name: 'a_b', tool: definition },
			],
			ctx,
			provider: 'anthropic',
			authType: 'oauth',
			registration,
		});
		const loader = createLazyToolLoaderState(
			{ a__b: definition },
			registration.canonicalToRegistration,
			'LoadTools',
			['a_b'],
		);
		expect(loader.loadedTools.size).toBe(0);
		const prepare = buildLazyPrepareStep(
			createLazyPrepareStepState(['LoadTools'], [loader]),
		);
		const rejectedStep = {
			toolCalls: [{ toolName: 'LoadTools', toolCallId: 'reject' }],
			toolResults: [
				{
					toolName: 'LoadTools',
					toolCallId: 'reject',
					output: { loaded: ['a_b'] },
				},
			],
		};
		expect(
			(await prepare({ stepNumber: 1, steps: [rejectedStep] })).activeTools,
		).toEqual(['LoadTools']);
		const acceptedStep = {
			toolCalls: [{ toolName: 'LoadTools', toolCallId: 'accept' }],
			toolResults: [
				{
					toolName: 'LoadTools',
					toolCallId: 'accept',
					output: { loaded: ['a__b'] },
				},
			],
		};
		expect(
			(await prepare({ stepNumber: 2, steps: [rejectedStep, acceptedStep] }))
				.activeTools,
		).toEqual(['LoadTools', 'AB']);
	});

	test('setup lazy loading uses exact maps and rejects a collision with a base tool', async () => {
		const db = await getDb(root);
		const cfg = await loadConfig(root);
		const registration = createToolRegistrationMap();
		const toolset = registerRunnerTools({
			tools: [
				{ name: 'load_tools', tool: definition },
				{ name: 'a__b', tool: definition },
			],
			ctx,
			provider: 'anthropic',
			authType: 'oauth',
			registration,
		});
		const setup = {
			db,
			cfg,
			sharedCtx: ctx,
			toolset,
			toolRegistration: registration,
			lazyToolsRecord: { a_b: definition, exact__name: definition },
			mcpToolsRecord: {},
			history: [],
		} as unknown as SetupResult;
		const result = await setupLazyToolLoading(
			{
				sessionId: 'test',
				assistantMessageId: 'message',
				projectRoot: root,
				agent: 'build',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
			},
			setup,
		);
		expect(Object.keys(result.toolset)).toEqual([
			'LoadTools',
			'AB',
			'ExactName',
		]);
		expect(registration.registrationToCanonical.AB).toBe('a__b');
		expect(registration.registrationToCanonical.ExactName).toBe('exact__name');
		const step = {
			toolCalls: [{ toolName: 'LoadTools', toolCallId: 'load' }],
			toolResults: [
				{
					toolName: 'LoadTools',
					toolCallId: 'load',
					output: { loaded: ['a_b', 'exact__name'] },
				},
			],
		};
		expect(
			(await result.prepareStep?.({ stepNumber: 1, steps: [step] }))
				?.activeTools,
		).toEqual(['LoadTools', 'AB', 'ExactName']);
	});
});
