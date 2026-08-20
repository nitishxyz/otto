import { logger } from '@ottocode/sdk';
import type { ContextFileReference } from './types.ts';

const MAX_TRACKED_PRELOADS = 1024;

type ContextMetric = {
	sessionId: string;
	completedAt: number;
	fileCount: number;
	totalBytes: number;
	preloadDurationMs: number;
	readKeys: Set<string>;
	firstActivityRecorded: boolean;
};

const metricsByMessageId = new Map<string, ContextMetric>();

function contextReadKey(input: ContextFileReference): string {
	return JSON.stringify({
		path: input.path,
		startLine: input.startLine,
		endLine: input.endLine,
		maxLines: input.maxLines,
	});
}

export function registerMessageContextMetrics(args: {
	messageId: string;
	sessionId: string;
	completedAt: number;
	fileCount: number;
	totalBytes: number;
	preloadDurationMs: number;
	files: ContextFileReference[];
}): void {
	if (metricsByMessageId.size >= MAX_TRACKED_PRELOADS) {
		const oldestKey = metricsByMessageId.keys().next().value;
		if (typeof oldestKey === 'string') metricsByMessageId.delete(oldestKey);
	}
	metricsByMessageId.set(args.messageId, {
		sessionId: args.sessionId,
		completedAt: args.completedAt,
		fileCount: args.fileCount,
		totalBytes: args.totalBytes,
		preloadDurationMs: args.preloadDurationMs,
		readKeys: new Set(args.files.map(contextReadKey)),
		firstActivityRecorded: false,
	});
}

export function recordMessageContextActivity(args: {
	messageId: string;
	kind: 'text' | 'tool';
	toolName?: string;
	input?: unknown;
}): void {
	const metric = metricsByMessageId.get(args.messageId);
	if (!metric) return;

	if (!metric.firstActivityRecorded) {
		metric.firstActivityRecorded = true;
		logger.info('[context] first activity after preload', {
			sessionId: metric.sessionId,
			messageId: args.messageId,
			kind: args.kind,
			toolName: args.toolName,
			timeToFirstActivityMs: Math.max(0, Date.now() - metric.completedAt),
			fileCount: metric.fileCount,
			totalBytes: metric.totalBytes,
			preloadDurationMs: metric.preloadDurationMs,
		});
	}

	if (
		args.kind === 'tool' &&
		args.toolName === 'read' &&
		args.input &&
		typeof args.input === 'object'
	) {
		const input = args.input as ContextFileReference;
		if (
			typeof input.path === 'string' &&
			metric.readKeys.has(contextReadKey(input))
		) {
			logger.info('[context] preloaded file reread', {
				sessionId: metric.sessionId,
				messageId: args.messageId,
				path: input.path,
				startLine: input.startLine,
				endLine: input.endLine,
				maxLines: input.maxLines,
			});
		}
	}
}
