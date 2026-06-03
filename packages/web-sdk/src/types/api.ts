export interface Session {
	id: string;
	title: string | null;
	agent: string;
	provider: string;
	model: string;
	projectPath: string;
	createdAt: number;
	lastActiveAt: number | null;
	lastViewedAt?: number | null;
	pinnedAt?: number | null;
	totalInputTokens: number | null;
	totalOutputTokens: number | null;
	totalCachedTokens?: number | null;
	totalCacheCreationTokens?: number | null;
	totalToolTimeMs: number | null;
	currentContextTokens?: number | null;
	toolCounts?: Record<string, number>;
	parentSessionId?: string | null;
	branchPointMessageId?: string | null;
	sessionType?: 'main' | 'branch' | 'handoff';
	isRunning?: boolean;
	fileStats?: {
		changedFiles: number;
		additions: number;
		deletions: number;
		operations: number;
	} | null;
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
	latencyMs: number | null;
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	error: string | null;
	parts?: MessagePart[];
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

export interface CreateSessionRequest {
	agent?: string;
	provider?: string;
	model?: string;
	title?: string;
}

export interface UpdateSessionRequest {
	title?: string;
	agent?: string;
	provider?: string;
	model?: string;
	isPinned?: boolean;
}

export interface SendMessageRequest {
	content: string;
	images?: Array<{ data: string; mediaType: string }>;
	files?: Array<{
		type: 'image' | 'pdf' | 'text' | 'binary';
		name: string;
		data?: string;
		mediaType: string;
		textContent?: string;
		attachmentId?: string;
		original?: {
			filename?: string;
			size?: number;
			sha256?: string;
			mimeType?: string;
		};
	}>;
	agent?: string;
	provider?: string;
	model?: string;
	oneShot?: boolean;
	userContext?: string;
	reasoningText?: boolean;
	reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
}

export interface SendMessageResponse {
	messageId: string;
}

export interface ModelInfo {
	id: string;
	label: string;
	toolCall?: boolean;
	reasoningText?: boolean;
	vision?: boolean;
	attachment?: boolean;
	free?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	available?: boolean;
	unavailableReason?: string;
}

export interface ProviderModels {
	label: string;
	authType?: 'api' | 'oauth' | 'wallet';
	allowAnyModel?: boolean;
	dynamicModels?: boolean;
	models: ModelInfo[];
}

export type AllModelsResponse = Record<string, ProviderModels>;

// Git-related types
export interface GitFileStatus {
	path: string;
	absPath: string; // NEW: Absolute filesystem path
	status:
		| 'modified'
		| 'added'
		| 'deleted'
		| 'renamed'
		| 'untracked'
		| 'conflicted';
	staged: boolean;
	insertions?: number;
	deletions?: number;
	oldPath?: string; // For renamed files
	isNew: boolean; // NEW: True for untracked or newly added files
	conflictType?:
		| 'both-modified'
		| 'deleted-by-us'
		| 'deleted-by-them'
		| 'both-added'
		| 'both-deleted';
}

export interface GitOperationState {
	type:
		| 'rebase'
		| 'rebase-interactive'
		| 'merge'
		| 'cherry-pick'
		| 'revert'
		| 'bisect';
	label: string;
	current?: number;
	total?: number;
	headName?: string;
	onto?: string;
}

export interface GitStatusResponse {
	branch: string;
	headSha: string;
	shortHeadSha: string;
	isDetached: boolean;
	operation: GitOperationState | null;
	ahead: number;
	behind: number;
	gitRoot: string; // NEW: Git repository root path
	workingDir: string; // NEW: Current working directory
	staged: GitFileStatus[];
	unstaged: GitFileStatus[];
	untracked: GitFileStatus[];
	conflicted: GitFileStatus[];
	hasChanges: boolean;
	hasConflicts: boolean;
	hasUpstream: boolean;
	remotes: string[];
}

export interface GitDiffResponse {
	file: string;
	absPath: string; // NEW: Absolute filesystem path
	diff: string;
	content?: string; // NEW: Full file content (for new files)
	isNewFile: boolean; // NEW: True if this is a new/untracked file
	language: string;
	insertions: number;
	deletions: number;
	isBinary: boolean; // Renamed from 'binary' for consistency
	staged: boolean; // NEW: Whether showing staged or unstaged version
}

export interface GitStageRequest {
	files: string[];
}

export interface GitStageResponse {
	staged: string[];
	failed: string[];
}

export interface GitUnstageRequest {
	files: string[];
}

export interface GitUnstageResponse {
	unstaged: string[];
	failed: string[];
}

export interface GitCommitRequest {
	message: string;
}

export interface GitCommitResponse {
	hash: string;
	message: string;
	filesChanged: number;
	insertions: number;
	deletions: number;
}

export interface GitGenerateCommitMessageResponse {
	message: string;
}

export interface GitBranchInfo {
	current: string;
	upstream: string;
	ahead: number;
	behind: number;
	all: string[];
}

export interface GitPushResponse {
	output: string;
}

export interface GitPullResponse {
	output: string;
	branch: string;
	rebase: boolean;
}

export interface GitRebaseActionResponse {
	action: 'continue' | 'abort' | 'skip';
	output: string;
}

export interface GitRemoteInfo {
	name: string;
	url: string;
	type: string;
}

export interface GitBranchListItem {
	name: string;
	fullName: string;
	current: boolean;
	remote: boolean;
	remoteName?: string;
	upstream?: string;
	sha?: string;
	subject?: string;
}

export interface GitBranchListResponse {
	current: string;
	branches: GitBranchListItem[];
}

export interface SessionFileOperation {
	path: string;
	operation: 'write' | 'patch' | 'create';
	timestamp: number;
	toolCallId: string;
	toolName: string;
	patch?: string;
	content?: string;
	artifact?: {
		kind: string;
		patch?: string;
		summary?: { additions: number; deletions: number };
	};
}

export interface SessionFile {
	path: string;
	operations: SessionFileOperation[];
	operationCount: number;
	firstModified: number;
	lastModified: number;
}

export interface SessionFilesResponse {
	files: SessionFile[];
	totalFiles: number;
	totalOperations: number;
}

// Session branching types
export interface CreateBranchRequest {
	fromMessageId: string;
	provider?: string;
	model?: string;
	agent?: string;
	title?: string;
}

export interface BranchResult {
	session: Session;
	parentSessionId: string;
	branchPointMessageId: string;
	copiedMessages: number;
	copiedParts: number;
}

export interface BranchInfo {
	session: Session;
	branchPointMessageId: string | null;
	branchPointPreview: string | null;
	createdAt: number;
}

export interface ListBranchesResponse {
	branches: BranchInfo[];
}

export interface ParentSessionResponse {
	parent: Session | null;
}

export interface InjectResearchContextResponse {
	content: string;
	label: string;
	sessionId: string;
	parentSessionId: string;
	tokenEstimate: number;
}

export interface ShareStatus {
	shared: boolean;
	shareId?: string;
	url?: string;
	title?: string | null;
	createdAt?: number;
	lastSyncedAt?: number;
	lastSyncedMessageId?: string;
	syncedMessages?: number;
	totalMessages?: number;
	pendingMessages?: number;
	isSynced?: boolean;
}

export interface ShareSessionResponse {
	shared: boolean;
	shareId: string;
	url: string;
	message?: string;
	error?: string;
}

export interface SyncSessionResponse {
	synced: boolean;
	url: string;
	newMessages: number;
	message?: string;
	error?: string;
}

export interface SessionsPage {
	items: Session[];
	hasMore: boolean;
	nextOffset: number | null;
}

export interface UsageWindow {
	usedPercent: number;
	windowSeconds: number;
	resetsAt: string | null;
	resetAfterSeconds?: number;
}

export interface ProviderUsageResponse {
	provider: string;
	primaryWindow: UsageWindow | null;
	secondaryWindow: UsageWindow | null;
	limitReached: boolean;
	planType?: string | null;
	sonnetWindow?: { usedPercent: number; resetsAt: string | null } | null;
	extraUsage?: {
		is_enabled: boolean;
		monthly_limit: number;
		used_credits: number;
		utilization: number | null;
	} | null;
	credits?: {
		has_credits: boolean;
		balance: number | null;
	} | null;
}
