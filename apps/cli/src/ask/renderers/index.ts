import type { RendererContext } from './types.ts';
import { renderReadCall, renderReadResult } from './read.ts';
import { renderWriteCall, renderWriteResult } from './write.ts';
import { renderPatchCall, renderPatchResult } from './patch.ts';
import {
	renderCopyIntoCall,
	renderCopyIntoResult,
	renderEditCall,
	renderEditResult,
	renderMultiEditCall,
	renderMultiEditResult,
} from './edit.ts';
import { renderBashCall, renderBashResult } from './bash.ts';
import { renderSearchCall, renderSearchResult } from './search.ts';
import { renderTreeCall, renderTreeResult } from './tree.ts';
import { renderListCall, renderListResult } from './list.ts';
import {
	renderGitStatusCall,
	renderGitStatusResult,
	renderGitDiffCall,
	renderGitDiffResult,
	renderGitCommitCall,
	renderGitCommitResult,
} from './git.ts';
import { renderWebSearchCall, renderWebSearchResult } from './websearch.ts';
import { renderTerminalCall, renderTerminalResult } from './terminal.ts';
import { isMcpTool, renderMcpCall, renderMcpResult } from './mcp.ts';
import {
	renderLoadMcpToolsCall,
	renderLoadMcpToolsResult,
} from './load-mcp-tools.ts';
import { renderSkillCall, renderSkillResult } from './skill.ts';
import {
	renderProgressCall,
	renderTodosCall,
	renderTodosResult,
	renderFinishCall,
	renderFinishResult,
	renderGenericCall,
	renderGenericResult,
} from './meta.ts';

type CallRenderer = (ctx: RendererContext) => string;
type ResultRenderer = (ctx: RendererContext) => string;

const callRenderers: Record<string, CallRenderer> = {
	read: renderReadCall,
	write: renderWriteCall,
	apply_patch: renderPatchCall,
	edit: renderEditCall,
	multiedit: renderMultiEditCall,
	copy_into: renderCopyIntoCall,
	shell: renderBashCall,
	bash: renderBashCall,
	terminal: renderTerminalCall,
	search: renderSearchCall,
	glob: renderSearchCall,
	tree: renderTreeCall,
	ls: renderListCall,
	git_status: renderGitStatusCall,
	git_diff: renderGitDiffCall,
	git_commit: renderGitCommitCall,
	websearch: renderWebSearchCall,
	progress_update: renderProgressCall,
	update_todos: renderTodosCall,
	finish: renderFinishCall,
	load_mcp_tools: renderLoadMcpToolsCall,
	skill: renderSkillCall,
};

const resultRenderers: Record<string, ResultRenderer> = {
	read: renderReadResult,
	write: renderWriteResult,
	apply_patch: renderPatchResult,
	edit: renderEditResult,
	multiedit: renderMultiEditResult,
	copy_into: renderCopyIntoResult,
	shell: renderBashResult,
	bash: renderBashResult,
	terminal: renderTerminalResult,
	search: renderSearchResult,
	glob: renderSearchResult,
	tree: renderTreeResult,
	ls: renderListResult,
	git_status: renderGitStatusResult,
	git_diff: renderGitDiffResult,
	git_commit: renderGitCommitResult,
	websearch: renderWebSearchResult,
	progress_update: renderGenericResult,
	update_todos: renderTodosResult,
	finish: renderFinishResult,
	load_mcp_tools: renderLoadMcpToolsResult,
	skill: renderSkillResult,
};

export function renderToolCall(ctx: RendererContext): string {
	const renderer =
		callRenderers[ctx.toolName] ??
		(isMcpTool(ctx.toolName) ? renderMcpCall : renderGenericCall);
	return renderer(ctx);
}

export function renderToolResult(ctx: RendererContext): string {
	const renderer =
		resultRenderers[ctx.toolName] ??
		(isMcpTool(ctx.toolName) ? renderMcpResult : renderGenericResult);
	return renderer(ctx);
}

export {
	renderSummary,
	renderContextHeader,
	renderSessionInfo,
	renderDoneMessage,
} from './summary.ts';
export { renderApprovalPrompt, promptApproval } from './approval.ts';
export type { ApprovalRequest } from './approval.ts';
export type { RendererContext } from './types.ts';
export { c, ICONS, formatMs, truncate } from './theme.ts';
export {
	renderThinkingDelta,
	renderThinkingEnd,
	isThinking,
} from './thinking.ts';
export { getSpinner } from './meta.ts';
