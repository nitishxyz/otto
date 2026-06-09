import type { Artifact } from '@ottocode/sdk';
import { ask, buildSessionStreamUrl, resolveApproval } from '@ottocode/api';
import { renderMarkdown } from '../ui.ts';
import {
	renderToolCall,
	renderToolResult,
	renderSummary,
	renderContextHeader,
	renderSessionInfo,
	renderDoneMessage,
	renderApprovalPrompt,
	promptApproval,
	c,
	ICONS,
	truncate as truncateStr,
	renderThinkingDelta,
	renderThinkingEnd,
	isThinking,
} from './renderers/index.ts';
import { getSpinner } from './renderers/meta.ts';
import {
	computeAssistantLines,
	computeAssistantSegments,
	extractFilesFromPatch,
	buildSequence,
	summarizeTools,
	collectDiffArtifacts,
} from './transcript.ts';
import type {
	AskOptions,
	AskHandshake,
	AssistantChunk,
	ToolCallRecord,
	ToolResultRecord,
	TokenUsageSummary,
	Transcript,
} from './types.ts';
import { connectSSE, safeJson } from './http.ts';
import { getOrStartServerUrl } from './server.ts';
import { extractToolError, isToolError } from '@ottocode/sdk/tools/error';

const SAFE_TOOLS = new Set(['finish', 'progress_update', 'update_todos']);

export async function runAsk(prompt: string, opts: AskOptions = {}) {
	const startedAt = Date.now();
	const projectRoot = opts.project ?? process.cwd();
	const baseUrl = await getOrStartServerUrl();

	const flags = parseFlags(process.argv);
	const jsonMode = flags.jsonEnabled || flags.jsonStreamEnabled;

	let sse: SSEConnection | null = null;
	try {
		const askBody = {
			prompt,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			allowUnknownModel: opts.wild,
			sessionId: opts.sessionId,
			last: opts.last,
			jsonMode,
			toolApproval: flags.autoApprove ? 'auto' : undefined,
		};

		const handshakeResponse = await ask({
			query: { project: projectRoot },
			body: askBody,
		});
		if (handshakeResponse.error) {
			throw new Error(JSON.stringify(handshakeResponse.error));
		}
		const handshake = handshakeResponse.data as AskHandshake;

		if (!jsonMode) {
			const agent = opts.agent ?? handshake.agent;
			const provider = (opts.provider ?? handshake.provider) as string;
			const model = opts.model ?? handshake.model;
			Bun.write(
				Bun.stderr,
				`${renderContextHeader({ agent, provider, model })}\n`,
			);
		}

		if (handshake.message && !jsonMode) {
			Bun.write(
				Bun.stderr,
				`${renderSessionInfo(handshake.message.kind, handshake.message.sessionId)}\n\n`,
			);
		}

		const sseUrl = buildSessionStreamUrl({
			baseUrl,
			sessionId: handshake.sessionId,
			projectPath: projectRoot,
		});
		sse = await connectSSE(sseUrl);

		const streamResult = await consumeAskStream({
			sse,
			assistantMessageId: handshake.assistantMessageId,
			sessionId: handshake.sessionId,
			baseUrl,
			jsonEnabled: flags.jsonEnabled,
			jsonStreamEnabled: flags.jsonStreamEnabled,
			verbose: flags.verbose,
			readVerbose: flags.readVerbose,
			autoApprove: flags.autoApprove,
		});
		sse = null;

		if (flags.jsonStreamEnabled) return;

		if (flags.jsonEnabled) {
			const { toolCounts, toolTimings, totalToolTimeMs } = summarizeTools(
				streamResult.toolCalls,
				streamResult.toolResults,
			);
			const assistantLines = computeAssistantLines(
				streamResult.assistantChunks,
			);
			const assistantSegments = computeAssistantSegments(
				streamResult.assistantChunks,
				streamResult.toolCalls,
			);
			const transcript: Transcript = {
				sessionId: handshake.sessionId,
				assistantMessageId: handshake.assistantMessageId,
				agent: handshake.agent,
				provider: handshake.provider,
				model: handshake.model,
				sequence: buildSequence({
					prompt,
					assistantSegments,
					toolCalls: streamResult.toolCalls,
					toolResults: streamResult.toolResults,
				}),
				filesTouched: Array.from(streamResult.filesTouched),
				summary: {
					toolCounts,
					toolTimings,
					totalToolTimeMs,
					filesTouched: Array.from(streamResult.filesTouched),
					diffArtifacts: collectDiffArtifacts(streamResult.toolResults),
					tokenUsage: streamResult.tokenUsage ?? undefined,
				},
				finishReason: streamResult.finishReason,
			};
			if (flags.jsonVerbose) {
				transcript.output = streamResult.output;
				transcript.assistantChunks = streamResult.assistantChunks;
				transcript.assistantLines = assistantLines;
				transcript.assistantSegments = assistantSegments;
				transcript.tools = {
					calls: streamResult.toolCalls,
					results: streamResult.toolResults,
				};
			}
			Bun.write(Bun.stdout, `${JSON.stringify(transcript, null, 2)}\n`);
			return;
		}

		if (
			streamResult.assistantChunks.length === 0 &&
			streamResult.output.trim().length
		) {
			Bun.write(Bun.stderr, `${renderMarkdown(streamResult.output)}\n`);
		}

		if (
			flags.summaryEnabled ||
			streamResult.finishSeen ||
			streamResult.toolCalls.length
		) {
			const summaryStr = renderSummary(
				streamResult.toolCalls,
				streamResult.toolResults,
				streamResult.filesTouched,
				streamResult.tokenUsage,
			);
			if (summaryStr) Bun.write(Bun.stderr, `${summaryStr}\n`);
		}

		Bun.write(Bun.stderr, `${renderDoneMessage(Date.now() - startedAt)}\n`);
	} finally {
		try {
			await sse?.close();
		} catch {}
	}
}

type StreamState = {
	output: string;
	assistantChunks: AssistantChunk[];
	toolCalls: ToolCallRecord[];
	toolResults: ToolResultRecord[];
	filesTouched: Set<string>;
	tokenUsage: TokenUsageSummary | null;
	finishReason?: string;
	finishSeen: boolean;
};

type SSEConnection = Awaited<ReturnType<typeof connectSSE>>;

type StreamFlags = {
	sse: SSEConnection;
	assistantMessageId: string;
	sessionId: string;
	baseUrl: string;
	jsonEnabled: boolean;
	jsonStreamEnabled: boolean;
	verbose: boolean;
	readVerbose: boolean;
	autoApprove: boolean;
};

async function consumeAskStream(flags: StreamFlags): Promise<StreamState> {
	const sse = flags.sse;
	let autoApproveAll = flags.autoApprove;
	const state: StreamState = {
		output: '',
		assistantChunks: [],
		toolCalls: [],
		toolResults: [],
		filesTouched: new Set(),
		tokenUsage: null,
		finishSeen: false,
	};
	const callById = new Map<string, number>();
	let lastPrintedCallId: string | null = null;
	let hasStartedText = false;
	let hadToolOutput = false;
	let spinnerInterval: ReturnType<typeof setInterval> | null = null;
	let spinnerCallId: string | null = null;
	let lastToolCallLine: string | null = null;

	try {
		for await (const ev of sse) {
			const event = ev.event;
			if (event === 'message.part.delta') {
				handleAssistantDelta(ev.data);
			} else if (event === 'tool.call') {
				handleToolCall(ev.data);
			} else if (event === 'reasoning.delta') {
				handleReasoningDelta(ev.data);
			} else if (event === 'tool.delta') {
				handleToolDelta(ev.data);
			} else if (event === 'tool.result') {
				handleToolResult(ev.data);
			} else if (event === 'plan.updated') {
				handlePlan(ev.data);
			} else if (event === 'tool.approval.required') {
				await handleApproval(ev.data);
			} else if (event === 'message.completed') {
				if (handleCompleted(ev.data)) break;
			} else if (event === 'error') {
				handleError(ev.data);
			}
		}
	} finally {
		await sse.close();
		if (spinnerInterval) clearInterval(spinnerInterval);
	}

	if (state.output.length && !flags.jsonEnabled && !flags.jsonStreamEnabled) {
		Bun.write(Bun.stdout, '\n');
	}

	return state;

	function handleAssistantDelta(raw: string) {
		const data = safeJson(raw);
		const messageId =
			typeof data?.messageId === 'string' ? data.messageId : undefined;
		const delta = typeof data?.delta === 'string' ? data.delta : undefined;
		if (messageId !== flags.assistantMessageId || !delta) return;
		state.output += delta;
		const ts = Date.now();
		state.assistantChunks.push({ ts, delta });
		if (flags.jsonStreamEnabled) {
			Bun.write(
				Bun.stdout,
				`${JSON.stringify({
					event: 'assistant.delta',
					ts,
					messageId: flags.assistantMessageId,
					delta,
				})}\n`,
			);
		} else if (!flags.jsonEnabled) {
			if (isThinking()) {
				const endOut = renderThinkingEnd();
				if (endOut) Bun.write(Bun.stderr, endOut);
			}
			if (spinnerInterval) {
				clearInterval(spinnerInterval);
				spinnerInterval = null;
				spinnerCallId = null;
			}
			if (!hasStartedText && hadToolOutput) {
				Bun.write(Bun.stdout, '\n');
			}
			hasStartedText = true;
			Bun.write(Bun.stdout, delta);
			lastPrintedCallId = null;
		}
	}

	function handleToolCall(raw: string) {
		const data = safeJson(raw);
		const name = typeof data?.name === 'string' ? data.name : 'tool';
		const callId = typeof data?.callId === 'string' ? data.callId : undefined;
		const ts = Date.now();
		state.toolCalls.push({ name, args: data?.args, callId, ts });
		if (callId) callById.set(callId, state.toolCalls.length - 1);
		if (flags.jsonStreamEnabled) {
			Bun.write(
				Bun.stdout,
				`${JSON.stringify({
					event: 'tool.call',
					ts,
					name,
					callId,
					args: data?.args,
				})}\n`,
			);
		} else if (!flags.jsonEnabled) {
			const output = renderToolCall({ toolName: name, args: data?.args });
			if (output) {
				if (spinnerInterval) {
					clearInterval(spinnerInterval);
					spinnerInterval = null;
					spinnerCallId = null;
				}
				if (isThinking()) {
					const endOut = renderThinkingEnd();
					if (endOut) Bun.write(Bun.stderr, endOut);
				}
				if (hasStartedText) {
					Bun.write(Bun.stderr, '\n');
				}
				Bun.write(Bun.stderr, `${output}\n`);
				lastPrintedCallId = callId ?? null;
				lastToolCallLine = output;
				hadToolOutput = true;
				hasStartedText = false;
				if (callId && name !== 'finish' && name !== 'progress_update') {
					spinnerCallId = callId;
					spinnerInterval = setInterval(() => {
						const spin = c.fgDark(getSpinner());
						Bun.write(
							Bun.stderr,
							`\x1b[A\x1b[2K\r${lastToolCallLine} ${spin}\n`,
						);
					}, 80);
				}
			}
		}
	}

	function handleReasoningDelta(raw: string) {
		if (flags.jsonEnabled || flags.jsonStreamEnabled) return;
		const data = safeJson(raw);
		const delta = typeof data?.delta === 'string' ? data.delta : '';
		if (!delta) return;
		const output = renderThinkingDelta(delta);
		if (output) {
			Bun.write(Bun.stderr, output);
		}
	}

	function handleToolDelta(raw: string) {
		const data = safeJson(raw);
		const name = typeof data?.name === 'string' ? data.name : 'tool';
		const channel = typeof data?.channel === 'string' ? data.channel : 'output';
		if (flags.jsonStreamEnabled) {
			Bun.write(
				Bun.stdout,
				`${JSON.stringify({
					event: 'tool.delta',
					ts: Date.now(),
					name,
					channel,
					delta: data?.delta,
				})}\n`,
			);
			return;
		}
		if (flags.jsonEnabled) return;
		if (channel === 'input' && !flags.verbose) return;
		const isReadOnly = [
			'read',
			'ls',
			'tree',
			'search',
			'git_diff',
			'git_status',
		].includes(name);
		if (isReadOnly && !flags.verbose && !flags.readVerbose) return;
		const delta =
			typeof data?.delta === 'string'
				? data.delta
				: JSON.stringify(data?.delta);
		if (!delta) return;
		lastPrintedCallId = null;
		if (spinnerInterval) {
			clearInterval(spinnerInterval);
			spinnerInterval = null;
			spinnerCallId = null;
		}
		Bun.write(
			Bun.stderr,
			`${c.dim(`[${channel}]`)} ${name} ${c.dim(ICONS.arrow)} ${truncateStr(delta, 160)}\n`,
		);
	}

	function handleToolResult(raw: string) {
		const data = safeJson(raw);
		const name = typeof data?.name === 'string' ? data.name : 'tool';
		const callId = typeof data?.callId === 'string' ? data.callId : undefined;
		const ts = Date.now();
		let durationMs: number | undefined;
		if (callId) {
			const idx = callById.get(callId);
			if (idx !== undefined) {
				const started = state.toolCalls[idx]?.ts;
				if (typeof started === 'number') durationMs = Math.max(0, ts - started);
			}
		}
		const artifact = data?.artifact as
			| { kind?: string; patch?: string }
			| undefined;
		state.toolResults.push({
			name,
			result: data?.result,
			artifact: artifact as unknown as Artifact,
			callId,
			ts,
			durationMs,
		});
		if (artifact?.kind === 'file_diff' && typeof artifact.patch === 'string') {
			for (const f of extractFilesFromPatch(artifact.patch))
				state.filesTouched.add(f);
		}
		const resultValue = data?.result as { path?: unknown } | undefined;
		const resultObject =
			data?.result &&
			typeof data.result === 'object' &&
			!Array.isArray(data.result)
				? (data.result as Record<string, unknown>)
				: null;
		const topLevelError =
			typeof data?.error === 'string' && data.error.trim().length
				? data.error
				: undefined;

		const hasErrorResult = isToolError(resultObject) || Boolean(topLevelError);
		if (name === 'write' && typeof resultValue?.path === 'string')
			state.filesTouched.add(String(resultValue.path));
		if (flags.jsonStreamEnabled) {
			Bun.write(
				Bun.stdout,
				`${JSON.stringify({
					event: 'tool.result',
					ts,
					name,
					callId,
					durationMs,
					result: data?.result,
					artifact: data?.artifact,
				})}\n`,
			);
			return;
		}
		if (flags.jsonEnabled) return;

		const errorMessage = hasErrorResult
			? (extractToolError(resultObject, topLevelError) ??
				'Tool reported an error')
			: undefined;

		const output = renderToolResult({
			toolName: name,
			args:
				data?.args ??
				(callId
					? state.toolCalls[callById.get(callId) ?? -1]?.args
					: undefined),
			result: data?.result,
			artifact: artifact as unknown as Artifact,
			durationMs,
			error: errorMessage,
			verbose: flags.verbose,
		});

		if (output) {
			if (spinnerInterval && callId === spinnerCallId) {
				clearInterval(spinnerInterval);
				spinnerInterval = null;
				spinnerCallId = null;
			}
			if (callId && callId === lastPrintedCallId) {
				Bun.write(Bun.stderr, `\x1b[A\x1b[2K\r${output}\n`);
			} else {
				Bun.write(Bun.stderr, `${output}\n`);
			}
		}

		lastPrintedCallId = null;
		lastToolCallLine = null;
		if (name === 'finish') state.finishSeen = true;
	}

	async function handleApproval(raw: string) {
		if (flags.jsonEnabled || flags.jsonStreamEnabled) return;
		lastPrintedCallId = null;
		if (spinnerInterval) {
			clearInterval(spinnerInterval);
			spinnerInterval = null;
			spinnerCallId = null;
		}
		const data = safeJson(raw);
		if (!data) return;

		const callId = typeof data.callId === 'string' ? data.callId : '';
		const toolName = typeof data.toolName === 'string' ? data.toolName : '';

		if (autoApproveAll || SAFE_TOOLS.has(toolName)) {
			await resolveApprovalHttp(flags.baseUrl, flags.sessionId, callId, true);
			return;
		}

		const prompt = renderApprovalPrompt({
			callId,
			toolName,
			args: data.args,
			messageId: typeof data.messageId === 'string' ? data.messageId : '',
		});
		Bun.write(Bun.stderr, prompt);

		const answer = await promptApproval();
		if (answer === 'always') {
			autoApproveAll = true;
			await resolveApprovalHttp(flags.baseUrl, flags.sessionId, callId, true);
		} else {
			await resolveApprovalHttp(
				flags.baseUrl,
				flags.sessionId,
				callId,
				answer === 'yes',
			);
		}
	}

	function handlePlan(raw: string) {
		if (flags.jsonEnabled || flags.jsonStreamEnabled) return;
		lastPrintedCallId = null;
		const data = safeJson(raw);
		const output = renderToolResult({
			toolName: 'update_todos',
			result: { items: data?.items, note: data?.note },
		});
		if (output) Bun.write(Bun.stderr, `${output}\n`);
	}

	function handleCompleted(raw: string) {
		const data = safeJson(raw);
		const completedId = typeof data?.id === 'string' ? data.id : undefined;
		if (completedId !== flags.assistantMessageId) return false;
		const usage = data?.usage as Record<string, unknown> | undefined;
		const candidate = mergeTokenUsage(usage, data?.costUsd, data?.finishReason);
		if (candidate) state.tokenUsage = candidate;
		if (
			typeof data?.finishReason === 'string' &&
			data.finishReason.trim().length
		)
			state.finishReason = data.finishReason.trim();
		if (flags.jsonStreamEnabled) {
			const payload: Record<string, unknown> = {
				event: 'assistant.completed',
				ts: Date.now(),
				messageId: flags.assistantMessageId,
			};
			if (state.tokenUsage) payload.usage = state.tokenUsage;
			Bun.write(Bun.stdout, `${JSON.stringify(payload)}\n`);
		}
		return true;
	}

	function handleError(raw: string) {
		const data = safeJson(raw);
		let errorMessage: string;
		if (typeof data?.error === 'string') {
			errorMessage = data.error;
		} else if (data && typeof data === 'object') {
			const parts: string[] = [];
			if (data.error) parts.push(String(data.error));
			if (data.message) parts.push(String(data.message));
			if (data.details && typeof data.details === 'object')
				parts.push(`Details: ${JSON.stringify(data.details, null, 2)}`);
			errorMessage = parts.length
				? parts.join('\n')
				: JSON.stringify(data, null, 2);
		} else {
			errorMessage = String(raw);
		}
		if (flags.jsonStreamEnabled) {
			Bun.write(
				Bun.stdout,
				`${JSON.stringify({
					event: 'error',
					ts: Date.now(),
					error: errorMessage,
				})}\n`,
			);
		} else {
			Bun.write(Bun.stderr, `\n${c.red('error')} ${errorMessage}\n`);
		}
	}
}

async function resolveApprovalHttp(
	baseUrl: string,
	sessionId: string,
	callId: string,
	approved: boolean,
): Promise<void> {
	try {
		const response = await resolveApproval({
			baseURL: baseUrl,
			path: { id: sessionId },
			body: { callId, approved },
		});
		if (response.error) throw new Error(JSON.stringify(response.error));
	} catch {}
}

function parseFlags(argv: string[]) {
	return {
		verbose: argv.includes('--verbose'),
		readVerbose: argv.includes('--read-verbose'),
		summaryEnabled: argv.includes('--summary'),
		jsonEnabled: argv.includes('--json'),
		jsonVerbose: argv.includes('--json-verbose'),
		jsonStreamEnabled: argv.includes('--json-stream'),
		autoApprove: argv.includes('--yes') || argv.includes('-y'),
	};
}

function mergeTokenUsage(
	usage: Record<string, unknown> | undefined,
	costUsd: unknown,
	finish: unknown,
): TokenUsageSummary | null {
	const inputTokens = toNumberOrUndefined(usage?.inputTokens);
	const outputTokens = toNumberOrUndefined(usage?.outputTokens);
	const totalTokens = toNumberOrUndefined(usage?.totalTokens);
	const cost = toNumberOrUndefined(costUsd);
	const finishReason =
		typeof finish === 'string' && finish.trim().length
			? finish.trim()
			: undefined;
	if (
		inputTokens == null &&
		outputTokens == null &&
		totalTokens == null &&
		cost == null &&
		!finishReason
	)
		return null;
	return {
		inputTokens: inputTokens ?? undefined,
		outputTokens: outputTokens ?? undefined,
		totalTokens:
			totalTokens ??
			((inputTokens ?? null) != null && (outputTokens ?? null) != null
				? (inputTokens ?? 0) + (outputTokens ?? 0)
				: undefined),
		costUsd: cost ?? undefined,
		finishReason,
	};
}

function toNumberOrUndefined(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed.length) return undefined;
		const parsed = Number(trimmed);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}
