import { loadConfig } from '@ottocode/sdk';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { toErrorMessage } from '../errors/handling.ts';
import { isDebugEnabled } from './state.ts';

function isDumpEnabled(): boolean {
	return isDebugEnabled();
}

export interface TurnDumpData {
	sessionId: string;
	messageId: string;
	timestamp: string;
	provider: string;
	model: string;
	agent: string;
	continuationCount?: number;
	system: {
		prompt: string;
		components: string[];
		length: number;
	};
	additionalSystemMessages: Array<{ role: string; content: string }>;
	history: Array<{
		role: string;
		content: unknown;
		_contentLength?: number;
	}>;
	finalMessages: Array<{
		role: string;
		content: unknown;
		_contentLength?: number;
	}>;
	tools: {
		names: string[];
		count: number;
	};
	modelConfig: {
		maxOutputTokens: number | undefined;
		effectiveMaxOutputTokens: number | undefined;
		providerOptions: Record<string, unknown>;
		isOpenAIOAuth: boolean;
		needsSpoof: boolean;
	};
	stream: {
		toolCalls: Array<{
			stepIndex: number;
			name: string;
			callId: string;
			args: unknown;
			timestamp: string;
		}>;
		toolResults: Array<{
			stepIndex: number;
			name: string;
			callId: string;
			result: unknown;
			_resultLength?: number;
			timestamp: string;
		}>;
		textDeltas: Array<{
			stepIndex: number;
			textSnapshot: string;
			length: number;
			timestamp: string;
		}>;
		steps: Array<{
			stepIndex: number;
			finishReason: string | undefined;
			usage?: {
				inputTokens?: number;
				outputTokens?: number;
			};
			timestamp: string;
		}>;
		finishReason?: string;
		rawFinishReason?: string;
		aborted: boolean;
	};
	error?: {
		message: string;
		name?: string;
		stack?: string;
	};
	duration?: number;
}

export class TurnDumpCollector {
	private data: TurnDumpData;
	private startTime: number;
	private lastTextSnapshot: string = '';
	private textSnapshotInterval = 2000;
	private lastTextSnapshotTime = 0;

	constructor(opts: {
		sessionId: string;
		messageId: string;
		provider: string;
		model: string;
		agent: string;
		continuationCount?: number;
	}) {
		this.startTime = Date.now();
		this.data = {
			sessionId: opts.sessionId,
			messageId: opts.messageId,
			timestamp: new Date().toISOString(),
			provider: opts.provider,
			model: opts.model,
			agent: opts.agent,
			continuationCount: opts.continuationCount,
			system: { prompt: '', components: [], length: 0 },
			additionalSystemMessages: [],
			history: [],
			finalMessages: [],
			tools: { names: [], count: 0 },
			modelConfig: {
				maxOutputTokens: undefined,
				effectiveMaxOutputTokens: undefined,
				providerOptions: {},
				isOpenAIOAuth: false,
				needsSpoof: false,
			},
			stream: {
				toolCalls: [],
				toolResults: [],
				textDeltas: [],
				steps: [],
				aborted: false,
			},
		};
	}

	setSystemPrompt(prompt: string, components: string[]) {
		this.data.system = {
			prompt,
			components,
			length: prompt.length,
		};
	}

	setAdditionalSystemMessages(msgs: Array<{ role: string; content: string }>) {
		this.data.additionalSystemMessages = msgs;
	}

	setHistory(history: Array<{ role: string; content: unknown }>) {
		this.data.history = history.map((m) => {
			const contentStr =
				typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
			return {
				role: m.role,
				content: m.content,
				_contentLength: contentStr.length,
			};
		});
	}

	setFinalMessages(
		msgs: Array<{ role: string; content: string | Array<unknown> }>,
	) {
		this.data.finalMessages = msgs.map((m) => {
			const contentStr =
				typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
			return {
				role: m.role,
				content: m.content,
				_contentLength: contentStr.length,
			};
		});
	}

	setTools(toolset: Record<string, unknown>) {
		const names = Object.keys(toolset);
		this.data.tools = { names, count: names.length };
	}

	setModelConfig(config: {
		maxOutputTokens: number | undefined;
		effectiveMaxOutputTokens: number | undefined;
		providerOptions: Record<string, unknown>;
		isOpenAIOAuth: boolean;
		needsSpoof: boolean;
	}) {
		this.data.modelConfig = config;
	}

	recordToolCall(
		stepIndex: number,
		name: string,
		callId: string,
		args: unknown,
	) {
		this.data.stream.toolCalls.push({
			stepIndex,
			name,
			callId,
			args,
			timestamp: new Date().toISOString(),
		});
	}

	recordToolResult(
		stepIndex: number,
		name: string,
		callId: string,
		result: unknown,
	) {
		const resultStr =
			typeof result === 'string' ? result : JSON.stringify(result);
		const truncated =
			resultStr.length > 50_000
				? `${resultStr.slice(0, 50_000)}...[TRUNCATED]`
				: result;
		this.data.stream.toolResults.push({
			stepIndex,
			name,
			callId,
			result: truncated,
			_resultLength: resultStr.length,
			timestamp: new Date().toISOString(),
		});
	}

	recordTextDelta(
		stepIndex: number,
		accumulated: string,
		opts?: { force?: boolean },
	) {
		const force = opts?.force === true;
		const now = Date.now();
		if (
			!force &&
			now - this.lastTextSnapshotTime < this.textSnapshotInterval &&
			this.lastTextSnapshot.length > 0
		) {
			return;
		}
		if (force && accumulated.length === 0 && this.lastTextSnapshot.length > 0) {
			return;
		}
		if (force && accumulated === this.lastTextSnapshot) {
			return;
		}
		this.lastTextSnapshotTime = now;
		this.lastTextSnapshot = accumulated;
		this.data.stream.textDeltas.push({
			stepIndex,
			textSnapshot:
				accumulated.length > 5000
					? `${accumulated.slice(0, 5000)}...[TRUNCATED at 5000 chars, total: ${accumulated.length}]`
					: accumulated,
			length: accumulated.length,
			timestamp: new Date().toISOString(),
		});
	}

	recordStepFinish(
		stepIndex: number,
		finishReason: string | undefined,
		usage?: { inputTokens?: number; outputTokens?: number },
	) {
		this.data.stream.steps.push({
			stepIndex,
			finishReason,
			usage,
			timestamp: new Date().toISOString(),
		});
	}

	recordStreamEnd(opts: {
		finishReason?: string;
		rawFinishReason?: string;
		aborted: boolean;
	}) {
		this.data.stream.finishReason = opts.finishReason;
		this.data.stream.rawFinishReason = opts.rawFinishReason;
		this.data.stream.aborted = opts.aborted;
	}

	recordError(err: unknown) {
		this.data.error = {
			message: toErrorMessage(err),
			name: err instanceof Error ? err.name : undefined,
			stack: err instanceof Error ? err.stack : undefined,
		};
	}

	async flush(projectRoot: string) {
		this.data.duration = Date.now() - this.startTime;

		const cfg = await loadConfig(projectRoot);
		const dumpDir = cfg.paths.debugDumpsDir;
		await mkdir(dumpDir, { recursive: true });

		const ts = new Date()
			.toISOString()
			.replace(/[:.]/g, '-')
			.replace('T', '_')
			.replace('Z', '');
		const sessionShort = this.data.sessionId.slice(0, 8);
		const filename = `turn_${ts}_${sessionShort}.json`;
		const filepath = join(dumpDir, filename);

		await Bun.write(filepath, JSON.stringify(this.data, null, 2));
		return filepath;
	}
}

export function shouldDumpTurn(): boolean {
	return isDumpEnabled();
}

export function createTurnDumpCollector(opts: {
	sessionId: string;
	messageId: string;
	provider: string;
	model: string;
	agent: string;
	continuationCount?: number;
}): TurnDumpCollector | null {
	if (!shouldDumpTurn()) return null;
	return new TurnDumpCollector(opts);
}
