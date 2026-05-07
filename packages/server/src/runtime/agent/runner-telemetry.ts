import { logger } from '@ottocode/sdk';
import { time } from '../debug/index.ts';
import type { RunOpts } from '../session/queue.ts';
import type { RunnerMessage } from './runner-reminders.ts';
import type { SetupResult } from './runner-setup.ts';

export function nowMs(): number {
	const perf = globalThis.performance;
	if (perf && typeof perf.now === 'function') return perf.now();
	return Date.now();
}

export function approximateMessageChars(messages: RunnerMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += message.role.length;
		if (typeof message.content === 'string') {
			total += message.content.length;
			continue;
		}
		try {
			total += JSON.stringify(message.content).length;
		} catch {}
	}
	return total;
}

export function summarizeToolShape(tools: Record<string, unknown>) {
	const names = Object.keys(tools);
	const entries = names.map((name) => {
		const toolValue = tools[name];
		let approxChars = 0;
		try {
			approxChars = JSON.stringify(toolValue).length;
		} catch {}
		return { name, approxChars };
	});
	entries.sort((a, b) => b.approxChars - a.approxChars);
	return {
		toolNames: names,
		toolSchemaCharsApprox: entries.reduce(
			(total, entry) => total + entry.approxChars,
			0,
		),
		largestTools: entries.slice(0, 8),
	};
}

export function createFirstOutputLatencyLogger(args: {
	opts: RunOpts;
	runStartedAt: number;
	queueWaitMs: number;
	timings: SetupResult['timings'];
}) {
	const streamStartTimer = time('runner:first-delta');
	let firstDeltaSeen = false;
	return (kind: 'text' | 'reasoning') => {
		if (firstDeltaSeen) return;
		firstDeltaSeen = true;
		const firstOutputMs = nowMs() - args.runStartedAt;
		streamStartTimer.end({
			kind,
			queueWaitMs: args.queueWaitMs,
			setupMs: args.timings.totalMs,
		});
		logger.info('[latency] first output', {
			sessionId: args.opts.sessionId,
			messageId: args.opts.assistantMessageId,
			agent: args.opts.agent,
			provider: args.opts.provider,
			model: args.opts.model,
			kind,
			queueWaitMs: args.queueWaitMs,
			firstOutputMs,
			setupMs: args.timings.totalMs,
			totalSinceEnqueueMs: args.queueWaitMs + firstOutputMs,
			timings: args.timings,
		});
	};
}

export function logStreamRequestReady(args: {
	opts: RunOpts;
	setup: SetupResult;
	queueWaitMs: number;
	messages: RunnerMessage[];
	toolset: Record<string, unknown>;
	hasPrepareStep: boolean;
}): void {
	const { opts, setup, queueWaitMs, messages, toolset, hasPrepareStep } = args;
	const toolShape = summarizeToolShape(toolset);
	logger.info('[latency] stream request ready', {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		queueWaitMs,
		setupMs: setup.timings.totalMs,
		messageCount: messages.length,
		toolCount: Object.keys(toolset).length,
		toolNames: toolShape.toolNames,
		toolSchemaCharsApprox: toolShape.toolSchemaCharsApprox,
		largestTools: toolShape.largestTools,
		hasPrepareStep,
		providerOptionsKeys: Object.keys(setup.providerOptions),
		systemPromptChars: setup.system.length,
		messageCharsApprox: approximateMessageChars(messages),
		additionalSystemMessages: setup.additionalSystemMessages.length,
		historyMessages: setup.history.length,
	});
}
