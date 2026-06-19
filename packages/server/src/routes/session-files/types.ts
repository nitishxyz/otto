export interface FileOperation {
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
	operations: FileOperation[];
	operationCount: number;
	firstModified: number;
	lastModified: number;
}

export interface ToolResultData {
	path?: string;
	targetPath?: string;
	args?: Record<string, unknown>;
	files?: Array<string | { path: string }>;
	result?: {
		ok?: boolean;
		artifact?: {
			kind?: string;
			patch?: string;
			summary?: { additions?: number; deletions?: number };
		};
	};
	artifact?: {
		kind?: string;
		patch?: string;
		summary?: { additions?: number; deletions?: number };
	};
	patch?: string;
}
