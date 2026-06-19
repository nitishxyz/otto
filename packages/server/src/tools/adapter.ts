import type { Tool } from 'ai';
import type { DiscoveredTool } from '@ottocode/sdk';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type {
	ToolAdapterContext,
	StepExecutionState,
} from '../runtime/tools/context.ts';
import {
	toClaudeCodeName,
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
import type { PendingCallMeta } from './adapter/pending.ts';
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
	const pendingCalls = new Map<string, PendingCallMeta[]>();
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
		// Use PascalCase for Claude Code OAuth, otherwise canonical (snake_case)
		const registrationName = useClaudeCodeNaming
			? toClaudeCodeName(canonicalName)
			: canonicalName;
		// Always use canonical name for DB storage and events
		const name = canonicalName;

		const processedToolErrors = new WeakSet<object>();

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
				const sanitizedOutput = stripToolResultArtifactsForModel(
					options.output,
				);
				const baseToModelOutput = (base as { toModelOutput?: ToModelOutputFn })
					.toModelOutput;
				if (typeof baseToModelOutput === 'function') {
					return baseToModelOutput({ ...options, output: sanitizedOutput });
				}
				return {
					type: 'json',
					value: toJsonValue(sanitizedOutput),
				};
			},
			async onInputStart(options: unknown) {
				await handleAdaptedToolInputStart({
					base,
					ctx,
					pendingCalls,
					name,
					options,
				});
			},
			async onInputDelta(options: unknown) {
				await handleAdaptedToolInputDelta({
					base,
					ctx,
					pendingCalls,
					name,
					options,
				});
			},
			async onInputAvailable(options: unknown) {
				await handleAdaptedToolInputAvailable({
					base,
					ctx,
					pendingCalls,
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
					pendingCalls,
					name,
					input,
					options,
					stepStates,
					failureState,
					processedToolErrors,
				});
			},
		} as Tool;
	}
	return out;
}
