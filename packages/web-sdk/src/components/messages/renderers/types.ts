// Error types matching SDK
export type ToolErrorType =
	| 'validation'
	| 'not_found'
	| 'permission'
	| 'execution'
	| 'timeout'
	| 'unsupported';

// Error response structure
export interface ToolErrorResponse {
	ok: false;
	error: string;
	errorType?: ToolErrorType;
	details?: {
		parameter?: string;
		value?: unknown;
		constraint?: string;
		suggestion?: string;
		[key: string]: unknown;
	};
	stack?: string;
}

// Success response (data spread at top level)
export interface ToolSuccessResponse {
	ok: true;
	[key: string]: unknown;
}

// Generic tool response
export type ToolResponse = ToolSuccessResponse | ToolErrorResponse;

export interface ToolCallArgs {
	text?: string;
	message?: string;
	amend?: boolean;
	signoff?: boolean;
	pct?: number;
	stage?: string;
	all?: boolean;
	cmd?: string;
	cwd?: string;
	command?: string;
	script?: string;
	input?: string;
	operation?: string;
	terminalId?: string;
	purpose?: string;
	path?: string;
	/** Full file contents supplied to the `write` tool. */
	content?: string;
	sourcePath?: string;
	targetPath?: string;
	startLine?: number;
	endLine?: number | 'end' | 'eof';
	insertAtLine?: number | 'append' | 'end' | 'eof';
	mode?: 'insert_before' | 'insert_after' | 'replace_range';
	targetStartLine?: number;
	targetEndLine?: number | 'end' | 'eof';
}

export interface ToolResultData {
	done?: boolean;
	ok?: boolean;
	error?: string;
	text?: string;
	result?: string | Record<string, unknown>;
	message?: string;
	pct?: number;
	stage?: string;
	all?: boolean;
	patch?: string;
	staged?: number;
	unstaged?: number;
	raw?: string[];
	path?: string;
	sourcePath?: string;
	targetPath?: string;
	sourceRange?: string;
	targetRange?: string;
	mode?: string;
	linesCopied?: number;
	lineRange?: string;
	content?: string;
	/** True when the `write` tool created the file instead of overwriting it. */
	created?: boolean;
	changed?: boolean;
	bytes?: number;
	mediaType?: string;
	data?: string;
	size?: number;
	transmittedSize?: number;
	sha256?: string;
	compressed?: boolean;
	width?: number;
	height?: number;
	artifact?: {
		patch?: string;
		summary?: {
			files?: number;
			additions?: number;
			deletions?: number;
		};
	};
	opsApplied?: number;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	entries?: Array<{ name: string; type: string }>;
	tree?: string;
	matches?: unknown[];
	files?: unknown[];
	cwd?: string;
	output?: string;
	// Terminal fields
	terminalId?: string;
	purpose?: string;
	command?: string;
	pid?: number;
	status?: string;
	lines?: number;
	terminals?: unknown[];
	count?: number;
	// Error fields
	errorType?: ToolErrorType;
	details?: {
		suggestion?: string;
		[key: string]: unknown;
	};
	// Additional fields for specific renderers
	diff?: string; // for GitDiffRenderer
	summary?: string; // for GitStatusRenderer
	changes?: Array<{
		filePath: string;
		kind: string;
		hunks: Array<{
			oldStart: number;
			oldLines: number;
			newStart: number;
			newLines: number;
			additions: number;
			deletions: number;
			context?: string;
		}>;
	}>;
	results?: unknown[]; // for WebSearchRenderer
	images?: Array<{ data: string; mimeType: string }>; // for MCP tool image responses
}

export interface ContentJson {
	text?: string;
	name?: string;
	args?: ToolCallArgs;
	callId?: string;
	result?: ToolResultData;
	artifact?: {
		patch?: string;
		summary?: {
			files?: number;
			additions?: number;
			deletions?: number;
		};
	};
	// Additional fields for ErrorRenderer
	error?: Record<string, unknown>;
	details?: Record<string, unknown>;
	message?: string;
	type?: string;
	isAborted?: boolean;
	errorType?: string;
	isRetryable?: boolean;
}

export interface RendererProps {
	contentJson: ContentJson;
	toolDurationMs?: number;
	isExpanded: boolean;
	onToggle: () => void;
	compact?: boolean;
}

export interface GenericRendererProps extends RendererProps {
	toolName?: string;
}
