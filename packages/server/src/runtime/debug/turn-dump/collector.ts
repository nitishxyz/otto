import { loadConfig } from '@ottocode/sdk';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toErrorMessage } from '../../errors/handling.ts';
import type { TurnDumpCollectorOptions, TurnDumpData } from './types.ts';
import { snapshot } from './snapshot.ts';

export class TurnDumpCollector {
	private data: TurnDumpData;
	private startTime: number;
	private lastTextSnapshot = '';
	private textSnapshotInterval = 2000;
	private lastTextSnapshotTime = 0;

	constructor(opts: TurnDumpCollectorOptions) {
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
			prompt: snapshot(prompt),
			components: snapshot(components),
			length: prompt.length,
		};
	}

	setAdditionalSystemMessages(msgs: Array<{ role: string; content: string }>) {
		this.data.additionalSystemMessages = snapshot(msgs);
	}

	setHistory(history: Array<{ role: string; content: unknown }>) {
		this.data.history = snapshot(history).map((message) => {
			const contentStr =
				typeof message.content === 'string'
					? message.content
					: JSON.stringify(message.content);
			return {
				role: message.role,
				content: snapshot(message.content),
				_contentLength: contentStr?.length ?? 0,
			};
		});
	}

	setFinalMessages(
		messages: Array<{ role: string; content: string | Array<unknown> }>,
	) {
		this.data.finalMessages = snapshot(messages).map((message) => {
			const contentStr =
				typeof message.content === 'string'
					? message.content
					: JSON.stringify(message.content);
			return {
				role: message.role,
				content: snapshot(message.content),
				_contentLength: contentStr?.length ?? 0,
			};
		});
	}

	setTools(toolset: Record<string, unknown>) {
		const names = snapshot(Object.keys(toolset));
		this.data.tools = { names, count: names.length };
	}

	setModelConfig(config: {
		maxOutputTokens: number | undefined;
		effectiveMaxOutputTokens: number | undefined;
		providerOptions: Record<string, unknown>;
		isOpenAIOAuth: boolean;
		needsSpoof: boolean;
	}) {
		this.data.modelConfig = snapshot(config);
	}

	recordToolCall(
		stepIndex: number,
		name: string,
		callId: string,
		args: unknown,
	) {
		if (this.data.stream.toolCalls.length >= 200) return;
		this.data.stream.toolCalls.push({
			stepIndex,
			name,
			callId,
			args: snapshot(args),
			timestamp: new Date().toISOString(),
		});
	}

	recordToolResult(
		stepIndex: number,
		name: string,
		callId: string,
		result: unknown,
	) {
		if (this.data.stream.toolResults.length >= 200) return;
		const truncated = snapshot(result);
		const resultStr = JSON.stringify(truncated) ?? '';
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
		if (this.data.stream.textDeltas.length >= 200) return;
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
		this.lastTextSnapshot = snapshot(accumulated.slice(0, 5000));
		this.data.stream.textDeltas.push({
			stepIndex,
			textSnapshot:
				accumulated.length > 5000
					? `${snapshot(accumulated.slice(0, 5000))}...[TRUNCATED at 5000 chars, total: ${accumulated.length}]`
					: snapshot(accumulated),
			length: accumulated.length,
			timestamp: new Date().toISOString(),
		});
	}

	recordStepFinish(
		stepIndex: number,
		finishReason: string | undefined,
		usage?: { inputTokens?: number; outputTokens?: number },
	) {
		if (this.data.stream.steps.length >= 200) return;
		this.data.stream.steps.push({
			stepIndex,
			finishReason,
			usage: snapshot(usage),
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
			message: snapshot(toErrorMessage(err)),
			name: err instanceof Error ? err.name : undefined,
			stack: err instanceof Error ? snapshot(err.stack) : undefined,
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
		const sessionShort = this.data.sessionId
			.slice(0, 8)
			.replace(/[^a-zA-Z0-9_-]/g, '_');
		const messageId = this.data.messageId.replace(/[^a-zA-Z0-9_-]/g, '_');
		const filename = `turn_${ts}_${sessionShort}_${messageId}.json`;
		const filepath = join(dumpDir, filename);

		await Bun.write(filepath, JSON.stringify(snapshot(this.data), null, 2));
		return filepath;
	}
}
