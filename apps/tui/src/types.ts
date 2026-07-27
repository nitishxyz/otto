export interface Session {
	id: string;
	title: string | null;
	agent: string;
	provider: string;
	model: string;
	projectPath: string;
	createdAt: number;
	lastActiveAt: number | null;
	totalInputTokens: number | null;
	totalOutputTokens: number | null;
	totalCachedTokens: number | null;
	totalCacheCreationTokens: number | null;
	currentContextTokens: number | null;
	ownCostUsd?: number;
	subagentCostUsd?: number;
	totalCostUsd?: number;
}

export interface Message {
	id: string;
	sessionId: string;
	role: 'system' | 'user' | 'assistant' | 'tool';
	status: 'pending' | 'complete' | 'error';
	agent: string;
	provider: string;
	model: string;
	createdAt: number;
	completedAt: number | null;
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	finishReason?: string | null;
	rawFinishReason?: string | null;
	finishDetails?: string | null;
	error: string | null;
	parts?: MessagePart[];
	attachmentNames?: string[];
}

export interface MessagePart {
	id: string;
	messageId: string;
	index: number;
	stepIndex: number | null;
	type:
		| 'text'
		| 'tool_call'
		| 'tool_result'
		| 'image'
		| 'file'
		| 'error'
		| 'reasoning';
	content: string;
	contentJson?: Record<string, unknown>;
	agent: string;
	provider: string;
	model: string;
	startedAt: number | null;
	completedAt: number | null;
	toolName: string | null;
	toolCallId: string | null;
	toolDurationMs: number | null;
	ephemeral?: boolean;
}

export interface SSEEvent {
	type: string;
	payload: Record<string, unknown>;
}

export interface PendingApproval {
	callId: string;
	toolName: string;
	args: unknown;
	messageId: string;
}

export interface PendingSecureInput {
	promptId: string;
	messageId?: string;
	callId?: string;
	prompt: string;
	inputKind: 'password' | 'text';
	allowRemember: boolean;
	allowEmpty: boolean;
	createdAt: number;
}

export type Overlay =
	| 'none'
	| 'sessions'
	| 'models'
	| 'commit'
	| 'help'
	| 'theme'
	| 'approvals'
	| 'mcp'
	| 'skills'
	| 'agents'
	| 'usage';

export interface AppState {
	sessionId: string | null;
	overlay: Overlay;
	isStreaming: boolean;
}
