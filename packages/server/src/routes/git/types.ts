export interface GitFile {
	path: string;
	absPath: string;
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
	oldPath?: string;
	isNew: boolean;
	conflictType?:
		| 'both-modified'
		| 'deleted-by-us'
		| 'deleted-by-them'
		| 'both-added'
		| 'both-deleted';
}

export type GitOperationType =
	| 'rebase'
	| 'rebase-interactive'
	| 'merge'
	| 'cherry-pick'
	| 'revert'
	| 'bisect';

export interface GitOperationState {
	type: GitOperationType;
	label: string;
	current?: number;
	total?: number;
	headName?: string;
	onto?: string;
}

export interface GitRoot {
	gitRoot: string;
}

export interface GitError {
	error: string;
	code?: string;
}
