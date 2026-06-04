import type { Artifact } from '@ottocode/sdk';
import type { ProviderId } from '@ottocode/sdk';

export type AskOptions = {
	agent?: string;
	provider?: ProviderId;
	model?: string;
	wild?: boolean;
	project?: string;
	sessionId?: string;
	last?: boolean;
};

export type AskHandshake = {
	sessionId: string;
	header: {
		agent?: string;
		provider?: string;
		model?: string;
		sessionId: string;
	};
	provider: ProviderId;
	model: string;
	agent: string;
	assistantMessageId: string;
	message?: { kind: 'created' | 'last'; sessionId: string };
};

export type SessionMeta = {
	id: string | number;
	agent?: string;
	provider?: string;
	model?: string;
};

export type AssistantChunk = { ts: number; delta: string };

export type ToolCallRecord = {
	name: string;
	args?: unknown;
	callId?: string;
	ts: number;
};

export type ToolResultRecord = {
	name: string;
	result?: unknown;
	artifact?: Artifact;
	callId?: string;
	ts: number;
	durationMs?: number;
};

export type TokenUsageSummary = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	costUsd?: number;
	finishReason?: string;
};

export type AssistantLine = {
	index: number;
	tsStart: number;
	tsEnd: number;
	text: string;
};

export type AssistantSegment = {
	index: number;
	tsStart: number;
	tsEnd: number;
	text: string;
};

type AssistantSequenceEntry = {
	type: 'assistant';
	tsStart: number;
	tsEnd: number;
	index: number;
	text: string;
};

type UserSequenceEntry = {
	type: 'user';
	ts: number;
	text: string;
};

type ToolCallSequenceEntry = {
	type: 'tool.call';
	ts: number;
	name: string;
	callId?: string;
	args?: unknown;
};

type ToolResultSequenceEntry = {
	type: 'tool.result';
	ts: number;
	name: string;
	callId?: string;
	durationMs?: number;
	result?: unknown;
	artifact?: Artifact;
};

export type SequenceEntry =
	| UserSequenceEntry
	| AssistantSequenceEntry
	| ToolCallSequenceEntry
	| ToolResultSequenceEntry;

export type Transcript = {
	sessionId: string | null;
	assistantMessageId: string;
	agent: string;
	provider: ProviderId;
	model: string;
	sequence: SequenceEntry[];
	filesTouched: string[];
	summary: {
		toolCounts: Record<string, number>;
		toolTimings: Array<{ name: string; durationMs?: number }>;
		totalToolTimeMs: number;
		filesTouched: string[];
		diffArtifacts: Array<{ name: string; summary: unknown }>;
		tokenUsage?: TokenUsageSummary;
	};
	finishReason?: string;
	output?: string;
	assistantChunks?: AssistantChunk[];
	assistantLines?: AssistantLine[];
	assistantSegments?: AssistantSegment[];
	tools?: { calls: ToolCallRecord[]; results: ToolResultRecord[] };
};
