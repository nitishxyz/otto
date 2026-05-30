import type { Tool } from 'ai';
import type { DiscoveredTool } from '@ottocode/sdk';
import type { JSONValue } from '@ai-sdk/provider';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type {
	ToolAdapterContext,
	StepExecutionState,
} from '../runtime/tools/context.ts';
import { isToolError } from '@ottocode/sdk/tools/error';
import {
	toClaudeCodeName,
	requiresClaudeCodeNaming,
} from '../runtime/tools/mapping.ts';
import {
	requiresApproval,
	requestApproval,
	skipsGuardApproval,
} from '../runtime/tools/approval.ts';
import { guardToolCall } from '../runtime/tools/guards.ts';
import { consumeToolStream, executeBaseTool } from './adapter/execution.ts';
import {
	logToolCall,
	logToolResult,
	publishPlanUpdated,
	publishToolCall,
	publishToolDelta,
	publishToolResult,
} from './adapter/events.ts';
import {
	computeToolTiming,
	persistToolCall,
	persistToolErrorResult,
	persistToolResultWithIndex,
	updateToolSessionStats,
} from './adapter/persistence.ts';
import {
	extractToolCallId,
	getPendingQueue,
	shiftPendingCall,
	type PendingCallMeta,
} from './adapter/pending.ts';
import {
	buildToolResultContent,
	createBlockedToolResult,
	createRejectedToolResult,
	createToolExceptionResult,
	markToolFailed,
	markToolSucceeded,
	stripToolResultArtifactsForModel,
	type ToolFailureState,
} from './adapter/results.ts';

export type { ToolAdapterContext } from '../runtime/tools/context.ts';

type ToolExecuteSignature = Tool['execute'] extends (
	input: infer Input,
	options: infer Options,
) => infer Result
	? { input: Input; options: Options; result: Result }
	: { input: unknown; options: unknown; result: unknown };
type ToolExecuteInput = ToolExecuteSignature['input'];
type ToolExecuteOptions = ToolExecuteSignature['options'] extends never
	? undefined
	: ToolExecuteSignature['options'];
type ToolExecuteReturn = ToolExecuteSignature['result'];
type ToModelOutputOptions = { output: unknown; [key: string]: unknown };
type ToModelOutputFn = (options: ToModelOutputOptions) => ToolResultOutput;

function toJsonValue(value: unknown): JSONValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JSONValue;
	} catch {
		return String(value) as JSONValue;
	}
}

function unwrapDoubleWrappedArgs(
	input: unknown,
	expectedName: string,
): typeof input {
	if (
		input &&
		typeof input === 'object' &&
		'name' in input &&
		'args' in input &&
		typeof (input as Record<string, unknown>).name === 'string' &&
		typeof (input as Record<string, unknown>).args === 'object' &&
		(input as Record<string, unknown>).args !== null
	) {
		const wrapped = input as { name: string; args: Record<string, unknown> };
		if (
			wrapped.name === expectedName ||
			wrapped.name.replace(/[_-]/g, '') === expectedName.replace(/[_-]/g, '')
		) {
			return wrapped.args as typeof input;
		}
	}
	return input;
}

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
				const sdkCallId = extractToolCallId(options);
				const queue = getPendingQueue(pendingCalls, name);
				queue.push({
					callId: sdkCallId || crypto.randomUUID(),
					startTs: Date.now(),
					stepIndex: ctx.stepIndex,
				});
				if (typeof base.onInputStart === 'function')
					// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
					await base.onInputStart(options as any);
			},
			async onInputDelta(options: unknown) {
				const delta = (options as { inputTextDelta?: string } | undefined)
					?.inputTextDelta;
				const queue = pendingCalls.get(name);
				const meta = queue?.length ? queue[queue.length - 1] : undefined;
				// Stream tool argument deltas as events if needed
				publishToolDelta(ctx, {
					name,
					channel: 'input',
					delta,
					stepIndex: meta?.stepIndex ?? ctx.stepIndex,
					callId: meta?.callId,
				});
				if (typeof base.onInputDelta === 'function')
					// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
					await base.onInputDelta(options as any);
			},
			async onInputAvailable(options: unknown) {
				const args = (options as { input?: unknown } | undefined)?.input;
				const sdkCallId = extractToolCallId(options);
				const queue = getPendingQueue(pendingCalls, name);
				let meta = queue.length ? queue[queue.length - 1] : undefined;
				if (!meta) {
					meta = {
						callId: sdkCallId || crypto.randomUUID(),
						startTs: Date.now(),
						stepIndex: ctx.stepIndex,
					};
					queue.push(meta);
				}
				if (sdkCallId && meta.callId !== sdkCallId) {
					meta.callId = sdkCallId;
				}
				meta.stepIndex = ctx.stepIndex;
				meta.args = args;
				const callId = meta.callId;
				const callPartId = crypto.randomUUID();
				const startTs = meta.startTs;

				if (
					!firstToolCallReported &&
					typeof ctx.onFirstToolCall === 'function'
				) {
					firstToolCallReported = true;
					try {
						ctx.onFirstToolCall();
					} catch {}
				}

				// Special-case: progress updates must render instantly. Publish before any DB work.
				if (name === 'progress_update') {
					publishToolCall(ctx, {
						name,
						input: args,
						callId,
						stepIndex: ctx.stepIndex,
					});
					logToolCall(ctx, { name, callId, stepIndex: ctx.stepIndex });
					// Persist synchronously to maintain correct ordering
					try {
						await persistToolCall(ctx, {
							partId: callPartId,
							name,
							input: args,
							callId,
							startTs,
							stepIndex: ctx.stepIndex,
						});
					} catch {}
					if (typeof base.onInputAvailable === 'function') {
						// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
						await base.onInputAvailable(options as any);
					}
					return;
				}

				// Publish promptly so UI shows the call header before results
				publishToolCall(ctx, {
					name,
					input: args,
					callId,
					stepIndex: ctx.stepIndex,
				});
				// Persist synchronously to maintain correct ordering
				try {
					await persistToolCall(ctx, {
						partId: callPartId,
						name,
						input: args,
						callId,
						startTs,
						stepIndex: ctx.stepIndex,
					});
				} catch {}
				// Start approval request with full args
				if (
					ctx.toolApprovalMode &&
					requiresApproval(name, ctx.toolApprovalMode)
				) {
					meta.approvalPromise = requestApproval(
						ctx.sessionId,
						ctx.messageId,
						callId,
						name,
						args,
					);
				}
				const guard = guardToolCall(name, args, {
					projectRoot: ctx.projectRoot,
				});
				if (guard.type === 'block') {
					meta.blocked = true;
					meta.blockReason = guard.reason;
				} else if (
					guard.type === 'approve' &&
					!meta.approvalPromise &&
					!skipsGuardApproval(ctx.toolApprovalMode)
				) {
					meta.approvalPromise = requestApproval(
						ctx.sessionId,
						ctx.messageId,
						callId,
						name,
						args,
					);
				}
				if (typeof base.onInputAvailable === 'function') {
					// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
					await base.onInputAvailable(options as any);
				}
			},
			async execute(input: ToolExecuteInput, options: ToolExecuteOptions) {
				input = unwrapDoubleWrappedArgs(input, name);
				const sdkCallId = extractToolCallId(options);
				const meta = shiftPendingCall(pendingCalls, name);
				const callIdFromQueue = sdkCallId || meta?.callId;
				const startTsFromQueue = meta?.startTs;
				const stepIndexForEvent = meta?.stepIndex ?? ctx.stepIndex;

				const stepKey =
					typeof stepIndexForEvent === 'number' &&
					Number.isFinite(stepIndexForEvent)
						? stepIndexForEvent
						: 0;
				let stepState = stepStates.get(stepKey);
				if (!stepState) {
					stepState = {
						chain: Promise.resolve(),
						failed: false,
						failedToolName: undefined,
					};
					stepStates.set(stepKey, stepState);
				}

				const executeWithGuards = async (): Promise<ToolExecuteReturn> => {
					try {
						if (meta?.blocked) {
							const blockedResult = createBlockedToolResult(meta.blockReason);
							await persistToolErrorResult(ctx, {
								name,
								errorResult: blockedResult,
								callId: callIdFromQueue,
								startTs: startTsFromQueue,
								stepIndexForEvent,
								input: meta?.args,
							});
							return blockedResult as ToolExecuteReturn;
						}
						// Await approval if it was requested in onInputAvailable
						if (meta?.approvalPromise) {
							const approved = await meta.approvalPromise;
							if (!approved) {
								const rejectedResult = createRejectedToolResult();
								await persistToolErrorResult(ctx, {
									name,
									errorResult: rejectedResult,
									callId: callIdFromQueue,
									startTs: startTsFromQueue,
									stepIndexForEvent,
									input: meta?.args,
								});
								return rejectedResult as ToolExecuteReturn;
							}
						}
						// Handle session-relative paths and cwd tools
						const res = executeBaseTool(ctx, {
							base,
							name,
							input,
							options,
						});
						let result: unknown = res;
						// If tool returns an async iterable, stream deltas while accumulating
						if (res && typeof res === 'object' && Symbol.asyncIterator in res) {
							result = await consumeToolStream(ctx, {
								stream: res as AsyncIterable<unknown>,
								name,
								stepIndex: stepIndexForEvent,
								callId: callIdFromQueue,
							});
						} else {
							// Await promise or passthrough value
							result = await Promise.resolve(res as ToolExecuteReturn);
						}

						if (isToolError(result)) {
							markToolFailed(stepState, failureState, name);

							await persistToolErrorResult(ctx, {
								name,
								errorResult: result,
								callId: callIdFromQueue,
								startTs: startTsFromQueue,
								stepIndexForEvent,
								input: meta?.args,
							});
							processedToolErrors.add(result as object);
							return result as ToolExecuteReturn;
						}

						const resultPartId = crypto.randomUUID();
						const callId = callIdFromQueue;
						const startTs = startTsFromQueue;
						const contentObj = buildToolResultContent({
							name,
							result,
							callId,
							input: meta?.args,
						});

						const index = await ctx.nextIndex();
						const { endTs, durationMs } = computeToolTiming(startTs);

						// Special-case: keep progress_update result lightweight; publish first, persist best-effort
						if (name === 'progress_update') {
							markToolSucceeded(stepState, failureState, name);
							publishToolResult(ctx, contentObj, stepIndexForEvent);
							// Persist without blocking the event loop
							(async () => {
								try {
									await persistToolResultWithIndex(ctx, {
										partId: resultPartId,
										index,
										name,
										content: contentObj,
										startTs,
										callId,
										stepIndex: stepIndexForEvent,
										endTs,
										durationMs,
									});
								} catch {}
							})();
							return result as ToolExecuteReturn;
						}

						markToolSucceeded(stepState, failureState, name);

						await persistToolResultWithIndex(ctx, {
							partId: resultPartId,
							index,
							name,
							content: contentObj,
							startTs,
							callId,
							stepIndex: stepIndexForEvent,
							endTs,
							durationMs,
						});
						// Update session aggregates: total tool time and counts per tool
						await updateToolSessionStats(ctx, {
							name,
							durationMs,
							endTs,
						});
						publishToolResult(ctx, contentObj, stepIndexForEvent);
						logToolResult(ctx, { name, callId, stepIndex: stepIndexForEvent });
						if (name === 'update_todos') {
							publishPlanUpdated(ctx, contentObj.result, contentObj.args);
						}
						return result as ToolExecuteReturn;
					} catch (error) {
						markToolFailed(stepState, failureState, name);

						// Tool execution failed
						if (
							isToolError(error) &&
							processedToolErrors.has(error as object)
						) {
							throw error;
						}

						const errorResult = isToolError(error)
							? error
							: createToolExceptionResult(error);

						await persistToolErrorResult(ctx, {
							name,
							errorResult,
							callId: callIdFromQueue,
							startTs: startTsFromQueue,
							stepIndexForEvent,
							input: meta?.args,
						});

						if (isToolError(error)) {
							processedToolErrors.add(error as object);
						}

						return errorResult as ToolExecuteReturn;
					}
				};

				const queued = stepState.chain
					.catch(() => undefined)
					.then(() => executeWithGuards());
				stepState.chain = queued.then(
					() => undefined,
					() => undefined,
				);
				return queued;
			},
		} as Tool;
	}
	return out;
}
