import type { Tool } from 'ai';
import {
	logger,
	getToolMetadata,
	setToolMetadata,
	type DiscoveredTool,
} from '@ottocode/sdk';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type {
	ToolAdapterContext,
	StepExecutionState,
} from '../runtime/tools/context.ts';
import {
	buildRegistrationNames,
	requiresClaudeCodeNaming,
} from '../runtime/tools/mapping.ts';
import {
	handleAdaptedToolInputAvailable,
	handleAdaptedToolInputDelta,
	handleAdaptedToolInputStart,
} from './adapter/input.ts';
import {
	toJsonValue,
	type ToModelOutputFn,
	type ToModelOutputOptions,
} from './adapter/model-output.ts';
import { createToolCallRecords } from './adapter/pending.ts';
import { boundModelOutput } from './adapter/result-compaction.ts';
import {
	stripToolResultArtifactsForModel,
	type ToolFailureState,
} from './adapter/results.ts';
import {
	handleAdaptedToolExecute,
	type ToolExecuteInput,
	type ToolExecuteOptions,
} from './adapter/tool-execute.ts';

export type { ToolAdapterContext } from '../runtime/tools/context.ts';

export function adaptTools(
	tools: DiscoveredTool[],
	ctx: ToolAdapterContext,
	provider?: string,
	authType?: string,
) {
	const out: Record<string, Tool> = {};
	const records = createToolCallRecords();
	const failureState: ToolFailureState = {
		active: false,
		toolName: undefined,
	};
	let firstToolCallReported = false;

	// Determine if we need Claude Code naming (PascalCase)
	const useClaudeCodeNaming = requiresClaudeCodeNaming(
		provider ?? '',
		authType,
	);
	const registration = buildRegistrationNames(
		tools.map(({ name }) => name),
		useClaudeCodeNaming,
	);
	for (const collision of registration.collisions) {
		logger.warn('[tools] rejected tool with colliding registration name', {
			registration: collision.registration,
			kept: collision.kept,
			rejected: collision.rejected,
		});
	}

	if (!ctx.stepExecution) {
		ctx.stepExecution = { states: new Map<number, StepExecutionState>() };
	}
	const stepStates = ctx.stepExecution.states;

	// Anthropic allows max 4 cache_control blocks
	// Cache only the most frequently used tools: read, write, shell
	const cacheableTools = new Set(['read', 'write', 'shell']);
	let cachedToolCount = 0;

	for (const { name: canonicalName, tool } of tools) {
		const base = tool;
		// Use PascalCase for Claude Code OAuth, otherwise canonical (snake_case).
		// Colliding names were rejected above and are not registered.
		const registrationName = registration.names.get(canonicalName);
		if (!registrationName || out[registrationName]) continue;
		// Always use canonical name for DB storage and events
		const name = canonicalName;

		// Add cache control for Anthropic to cache tool definitions (max 2 tools)
		const shouldCache =
			provider === 'anthropic' &&
			cacheableTools.has(name) &&
			cachedToolCount < 2;

		if (shouldCache) {
			cachedToolCount++;
		}

		const providerOptions = shouldCache
			? { anthropic: { cacheControl: { type: 'ephemeral' as const } } }
			: undefined;

		out[registrationName] = {
			...base,
			...(providerOptions ? { providerOptions } : {}),
			toModelOutput(options: ToModelOutputOptions): ToolResultOutput {
				const baseToModelOutput = (base as { toModelOutput?: ToModelOutputFn })
					.toModelOutput;
				if (typeof baseToModelOutput === 'function') {
					// Custom renderers still go through the shared byte budget.
					return boundModelOutput(baseToModelOutput(options));
				}
				const sanitizedOutput = stripToolResultArtifactsForModel(
					options.output,
					{ toolName: name },
				);
				return boundModelOutput({
					type: 'json',
					value: toJsonValue(sanitizedOutput),
				});
			},
			async onInputStart(options: unknown) {
				await handleAdaptedToolInputStart({
					base,
					ctx,
					records,
					name,
					options,
				});
			},
			async onInputDelta(options: unknown) {
				await handleAdaptedToolInputDelta({
					base,
					ctx,
					records,
					name,
					options,
				});
			},
			async onInputAvailable(options: unknown) {
				await handleAdaptedToolInputAvailable({
					base,
					ctx,
					records,
					name,
					options,
					markFirstToolCallReported: () => {
						if (firstToolCallReported) return false;
						firstToolCallReported = true;
						return true;
					},
				});
			},
			async execute(input: ToolExecuteInput, options: ToolExecuteOptions) {
				return handleAdaptedToolExecute({
					base,
					ctx,
					records,
					name,
					input,
					options,
					stepStates,
					failureState,
				});
			},
		} as Tool;
		const metadata = getToolMetadata(base);
		if (metadata) setToolMetadata(out[registrationName], metadata);
	}
	return out;
}
