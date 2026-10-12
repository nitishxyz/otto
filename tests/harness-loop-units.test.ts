import { describe, expect, test } from 'bun:test';
import { APICallError } from 'ai';
import type { ModelMessage } from 'ai';
import type { OttoConfig } from '@ottocode/sdk';
import {
	normalizeProvider,
	resolveConfiguredAgentProvider,
} from '../packages/server/src/runtime/agent/registry/normalize.ts';
import { toErrorPayload } from '../packages/server/src/runtime/errors/handling.ts';
import {
	buildLazyPrepareStep,
	createLazyPrepareStepState,
	createLazyToolLoaderState,
} from '../packages/server/src/runtime/agent/lazy-prepare-step.ts';
import { withTodoReminderPrepareStep } from '../packages/server/src/runtime/agent/runner/runner-todo-reminder.ts';
import { withRetainedResultPairs } from '../packages/server/src/runtime/agent/turn/prepare-step.ts';
import { resolveRunnerModelCapabilities } from '../packages/server/src/runtime/agent/runner/runner-setup-model.ts';

function cfgWithProviders(providers: OttoConfig['providers']): OttoConfig {
	return {
		projectRoot: '/tmp/otto-harness-registry',
		defaults: { agent: 'build', provider: 'openai', model: 'gpt-5' },
		providers,
	} as OttoConfig;
}

describe('agent provider defaults', () => {
	test('custom provider ids survive normalization', () => {
		expect(normalizeProvider(' my-ollama ')).toBe('my-ollama');
		expect(normalizeProvider('OpenAI')).toBe('openai');
		expect(normalizeProvider('not a provider!')).toBeUndefined();
	});

	test('custom providers are validated against loaded config', () => {
		const cfg = cfgWithProviders({
			'my-ollama': {
				enabled: true,
				custom: true,
				compatibility: 'ollama',
				baseURL: 'http://127.0.0.1:11434/api',
				models: {},
			},
		} as OttoConfig['providers']);
		expect(resolveConfiguredAgentProvider('my-ollama', cfg)).toBe('my-ollama');
		expect(resolveConfiguredAgentProvider('missing', cfg)).toBeUndefined();
		expect(resolveConfiguredAgentProvider('anthropic', cfg)).toBe('anthropic');
	});
});

describe('client error details', () => {
	test('omit provider request bodies and redact credentials', () => {
		const error = new APICallError({
			message: 'Bad request',
			url: 'https://api.example.test/v1/messages?key=secret-query',
			requestBodyValues: {
				model: 'claude-sonnet-4-5',
				messages: [{ role: 'user', content: 'private prompt' }],
			},
			statusCode: 400,
			responseHeaders: {
				authorization: 'Bearer sk-live-abcdefghijklmnop',
				'set-cookie': 'session=abc',
				'x-request-id': 'req_1',
			},
			responseBody: `${'x'.repeat(5000)} api_key=sk-abcdefghijklmnop`,
		});
		const payload = toErrorPayload(error);
		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain('private prompt');
		expect(serialized).not.toContain('sk-live-abcdefghijklmnop');
		expect(serialized).not.toContain('session=abc');
		expect(serialized).not.toContain('secret-query');
		expect(payload.details?.requestBodyValues).toEqual({
			model: 'claude-sonnet-4-5',
		});
		expect(payload.details?.responseHeaders).toEqual({
			'x-request-id': 'req_1',
		});
		expect(String(payload.details?.responseBody).length).toBeLessThan(2100);
	});
});

describe('lazy tool activation', () => {
	test('matches load results by toolCallId and consumes steps incrementally', async () => {
		const loader = createLazyToolLoaderState(
			{},
			{ grep: 'grep', glob: 'glob' },
			'load_tools',
		);
		const refreshed: number[] = [];
		const prepare = buildLazyPrepareStep(
			createLazyPrepareStepState(['read'], [loader], ({ steps }) => {
				refreshed.push(steps.length);
			}),
		);
		const step = {
			toolCalls: [
				{ toolCallId: 'a', toolName: 'load_tools', input: {} },
				{ toolCallId: 'b', toolName: 'load_tools', input: {} },
			],
			toolResults: [
				{
					toolCallId: 'b',
					toolName: 'load_tools',
					output: { loaded: ['grep'] },
				},
				{
					toolCallId: 'a',
					toolName: 'load_tools',
					output: { loaded: ['glob'] },
				},
			],
		};
		const first = await prepare({ stepNumber: 1, steps: [step] });
		expect(new Set(first.activeTools)).toEqual(
			new Set(['read', 'grep', 'glob']),
		);
		await prepare({ stepNumber: 2, steps: [step, { toolCalls: [] }] });
		expect(refreshed).toEqual([1, 1]);
	});

	test('a failed load call does not borrow another call result', async () => {
		const loader = createLazyToolLoaderState({}, {}, 'load_tools');
		const prepare = buildLazyPrepareStep(
			createLazyPrepareStepState([], [loader]),
		);
		const result = await prepare({
			stepNumber: 1,
			steps: [
				{
					toolCalls: [{ toolCallId: 'a', toolName: 'load_tools' }],
					toolResults: [
						{
							toolCallId: 'other',
							toolName: 'load_tools',
							output: { loaded: ['x'] },
						},
					],
				},
			],
		});
		expect(result.activeTools).toEqual([]);
	});
});

describe('prepare-step pipeline', () => {
	test('todo stage transforms the previous stage messages', async () => {
		const injected = { role: 'user', content: 'from inner stage' };
		const todoCall = {
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolName: 'update_todos',
					input: { todos: [{ step: 'one', status: 'pending' }] },
				},
			],
		};
		const stage = withTodoReminderPrepareStep(async (args) => ({
			messages: [...args.messages, injected],
		}));
		const result = (await stage({
			stepNumber: 10,
			steps: Array.from({ length: 10 }, () => ({ toolCalls: [] })),
			messages: [todoCall],
		})) as { messages: unknown[] };
		expect(result.messages).toContain(injected);
		expect(result.messages).toHaveLength(3);
	});

	test('retained pairs stay in place across steps', async () => {
		let calls = 0;
		const stage = withRetainedResultPairs(
			undefined,
			async () => {
				calls += 1;
				if (calls !== 1) return undefined;
				return {
					callId: 'pair-1',
					messages: [
						{
							role: 'assistant',
							content: [
								{
									type: 'tool-call',
									toolCallId: 'pair-1',
									toolName: 'x',
									input: {},
								},
							],
						},
					] as ModelMessage[],
				};
			},
			() => {},
		);
		const first: ModelMessage[] = [{ role: 'user', content: 'hi' }];
		const one = await stage({ stepNumber: 0, steps: [], messages: first });
		expect(one?.messages).toHaveLength(2);
		const second: ModelMessage[] = [
			...first,
			{ role: 'assistant', content: 'next' },
		];
		const two = await stage({ stepNumber: 1, steps: [], messages: second });
		expect(two?.messages?.[1]).toEqual(one?.messages?.[1]);
		expect(two?.messages).toHaveLength(3);
	});
});

describe('runtime setup helpers', () => {
	test('ai sdk warning handler install is restorable', () => {
		const script = `
			const mod = await import(${JSON.stringify(
				new URL(
					'../packages/server/src/runtime/ai-sdk-warnings.ts',
					import.meta.url,
				).pathname,
			)});
			const sentinel = () => {};
			globalThis.AI_SDK_LOG_WARNINGS = sentinel;
			const releaseA = mod.installAiSdkWarningHandler();
			const releaseB = mod.installAiSdkWarningHandler();
			const installed = globalThis.AI_SDK_LOG_WARNINGS !== sentinel;
			releaseA();
			releaseA();
			const stillInstalled = globalThis.AI_SDK_LOG_WARNINGS !== sentinel;
			releaseB();
			console.log(JSON.stringify({ installed, stillInstalled, restored: globalThis.AI_SDK_LOG_WARNINGS === sentinel }));
		`;
		const proc = Bun.spawnSync([process.execPath, '-e', script]);
		const output = JSON.parse(
			proc.stdout.toString().trim().split('\n').at(-1) ?? '{}',
		);
		expect(output).toEqual({
			installed: true,
			stillInstalled: true,
			restored: true,
		});
	});

	test('copilot transport is decided once from the SDK rule', () => {
		expect(
			resolveRunnerModelCapabilities({ provider: 'copilot', model: 'gpt-5.2' })
				.transport,
		).toBe('copilot-responses');
		expect(
			resolveRunnerModelCapabilities({
				provider: 'copilot',
				model: 'gpt-5-mini',
			}).transport,
		).toBe('copilot-chat');
		expect(
			resolveRunnerModelCapabilities({
				provider: 'copilot',
				model: 'claude-sonnet-4.5',
			}).transport,
		).toBe('copilot-chat');
	});
});
