export type AppliedPatchOperationKind = 'add' | 'update' | 'delete';

export type PatchOperationKind =
	| AppliedPatchOperationKind
	| 'line-delete'
	| 'line-replace'
	| 'line-insert';

export interface PatchHunkLine {
	kind: 'context' | 'add' | 'remove';
	content: string;
}

export interface PatchHunkHeader {
	oldStart?: number;
	oldLines?: number;
	newStart?: number;
	newLines?: number;
	context?: string;
}

export interface PatchHunk {
	header: PatchHunkHeader;
	lines: PatchHunkLine[];
}

export interface PatchAddOperation {
	kind: 'add';
	filePath: string;
	lines: string[];
}

export interface PatchDeleteOperation {
	kind: 'delete';
	filePath: string;
}

export interface PatchUpdateOperation {
	kind: 'update';
	filePath: string;
	hunks: PatchHunk[];
}

export interface PatchLineDeleteOperation {
	kind: 'line-delete';
	filePath: string;
	startLine: number;
	endLine: number | 'end';
}

export interface PatchLineReplaceOperation {
	kind: 'line-replace';
	filePath: string;
	startLine: number;
	endLine: number | 'end';
	lines: string[];
}

export interface PatchLineInsertOperation {
	kind: 'line-insert';
	filePath: string;
	position: 'before' | 'after';
	line: number;
	lines: string[];
}

export type PatchOperation =
	| PatchAddOperation
	| PatchDeleteOperation
	| PatchUpdateOperation
	| PatchLineDeleteOperation
	| PatchLineReplaceOperation
	| PatchLineInsertOperation;

export interface AppliedPatchHunk {
	header: PatchHunkHeader;
	lines: PatchHunkLine[];
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	additions: number;
	deletions: number;
}

export interface AppliedPatchOperation {
	kind: AppliedPatchOperationKind;
	filePath: string;
	stats: {
		additions: number;
		deletions: number;
	};
	hunks: AppliedPatchHunk[];
}

export interface PatchSummary {
	files: number;
	additions: number;
	deletions: number;
}

export interface PatchApplicationResult {
	operations: AppliedPatchOperation[];
	summary: PatchSummary;
	normalizedPatch: string;
	rejected: RejectedPatch[];
}

export interface RejectedPatch {
	kind: PatchOperationKind;
	filePath: string;
	reason: string;
	operation: PatchOperation;
}
