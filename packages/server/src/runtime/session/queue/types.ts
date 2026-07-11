import type { ReasoningLevel } from '@ottocode/sdk';
import type { ProviderName } from '../../provider/index.ts';
import type { ToolApprovalMode } from '../../tools/approval.ts';

export type RunOpts = {
	sessionId: string;
	assistantMessageId: string;
	agent: string;
	provider: ProviderName;
	model: string;
	projectRoot: string;
	projectId?: string;
	queuedAt?: number;
	oneShot?: boolean;
	userContent?: string;
	userContext?: string;
	estimatedInputTokens?: number;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	abortSignal?: AbortSignal;
	/**
	 * Omits prior session history from prompt assembly only. The run still emits
	 * events, tool calls, and persisted message parts in the current session.
	 */
	omitHistory?: boolean;
	isCompactCommand?: boolean;
	compactionContext?: string;
	additionalPromptMessages?: Array<{
		role: 'system' | 'user';
		content: string;
	}>;
	toolApprovalMode?: ToolApprovalMode;
	compactionRetries?: number;
	continuationCount?: number;
	streamIdleRetryCount?: number;
};

export type QueuedMessage = {
	messageId: string;
	position: number;
};

export type SendNowPreemptReason = {
	type: 'send-now-preempt';
	nextMessageId: string;
};

export type SystemAbortReason =
	| { type: 'parent-session-aborted' }
	| { type: 'subagent-stopped-by-parent' };

export type RunAbortReason = SendNowPreemptReason | SystemAbortReason;

export type RunnerState = {
	projectId?: string;
	projectRoot?: string;
	queue: RunOpts[];
	running: boolean;
	currentMessageId: string | null;
};

export type QueueStateSnapshot = {
	currentMessageId: string | null;
	queuedMessages: QueuedMessage[];
	isRunning: boolean;
};

export type SendQueuedMessageNowResult =
	| {
			success: true;
			promoted: boolean;
			wasQueued: boolean;
			wasRunning: boolean;
			preemptedMessageId: string | null;
	  }
	| { success: false };
