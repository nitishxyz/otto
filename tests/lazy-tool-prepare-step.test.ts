import { describe, expect, test } from 'bun:test';
import {
	buildPrepareStep,
	createLazyToolPrepareStepState,
	getLoadedLazyToolsFromMessages,
} from '../packages/server/src/runtime/agent/mcp-prepare-step.ts';

const loaders = [
	{
		registrationName: 'load_builtin_toolset',
		canonicalToRegistration: {
			simulator: 'simulator',
		},
	},
];

describe('lazy tool prepare step', () => {
	test('hydrates loaded tools from prior model messages', async () => {
		const initialLoadedTools = getLoadedLazyToolsFromMessages(
			[
				{
					role: 'assistant',
					content: [
						{
							type: 'tool-load_builtin_toolset',
							output: JSON.stringify({ loaded: ['simulator'] }),
						},
					],
				},
			],
			loaders,
		);

		const state = createLazyToolPrepareStepState(
			['progress_update', 'finish', 'load_builtin_toolset'],
			loaders,
			initialLoadedTools,
		);
		const prepareStep = buildPrepareStep(state);

		await expect(prepareStep({ stepNumber: 0, steps: [] })).resolves.toEqual({
			activeTools: [
				'progress_update',
				'finish',
				'load_builtin_toolset',
				'simulator',
			],
		});
	});

	test('hydrates loaded tools from converted tool result messages', async () => {
		const initialLoadedTools = getLoadedLazyToolsFromMessages(
			[
				{
					role: 'tool',
					content: [
						{
							type: 'tool-result',
							toolName: 'load_builtin_toolset',
							output: {
								type: 'text',
								value: JSON.stringify({ loaded: ['simulator'] }),
							},
						},
					],
				},
			],
			loaders,
		);

		expect(initialLoadedTools).toEqual(['simulator']);
	});

	test('loads tools from string outputs in the current turn', async () => {
		const state = createLazyToolPrepareStepState(
			['progress_update', 'finish', 'load_builtin_toolset'],
			loaders,
		);
		const prepareStep = buildPrepareStep(state);

		await expect(
			prepareStep({
				stepNumber: 1,
				steps: [
					{
						toolCalls: [
							{
								toolName: 'load_builtin_toolset',
								input: { toolsets: ['simulator'] },
							},
						],
						toolResults: [
							{
								toolName: 'load_builtin_toolset',
								output: JSON.stringify({ loaded: ['simulator'] }),
							},
						],
					},
				],
			}),
		).resolves.toEqual({
			activeTools: [
				'progress_update',
				'finish',
				'load_builtin_toolset',
				'simulator',
			],
		});
	});
});
