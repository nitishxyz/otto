import { useState } from 'react';
import type { ContentJson } from './types';
import { ReadRenderer } from './ReadRenderer';
import { ReadImageRenderer } from './ReadImageRenderer';
import { WriteRenderer } from './WriteRenderer';
import { BashRenderer } from './BashRenderer';
import { GitStatusRenderer } from './GitStatusRenderer';
import { GitDiffRenderer } from './GitDiffRenderer';
import { GitCommitRenderer } from './GitCommitRenderer';
import { ApplyPatchRenderer } from './ApplyPatchRenderer';
import { CopyIntoRenderer } from './CopyIntoRenderer';
import { CopyAttachmentRenderer } from './CopyAttachmentRenderer';
import { ListRenderer } from './ListRenderer';
import { TreeRenderer } from './TreeRenderer';
import { SearchRenderer } from './SearchRenderer';
import { FinishRenderer } from './FinishRenderer';
import { GenericRenderer } from './GenericRenderer';
import { DebugRenderer } from './DebugRenderer';
import { ProgressUpdateRenderer } from './ProgressUpdateRenderer';
import { WebSearchRenderer } from './WebSearchRenderer';
import { ErrorRenderer } from './ErrorRenderer';
import { DatabaseToolRenderer } from './DatabaseToolRenderer';
import { TerminalRenderer } from './TerminalRenderer';
import { McpToolRenderer, isMcpTool } from './McpToolRenderer';
import { LoadMcpToolsRenderer } from './LoadMcpToolsRenderer';
import { LoadToolsRenderer } from './LoadToolsRenderer';
import { McpManagerRenderer } from './McpManagerRenderer';
import { SimulatorRenderer } from './SimulatorRenderer';
import { SkillRenderer } from './SkillRenderer';

interface ToolResultRendererProps {
	toolName: string;
	contentJson: ContentJson;
	toolDurationMs?: number | null;
	debug?: boolean;
	onNavigateToSession?: (sessionId: string) => void;
	compact?: boolean;
	sessionId?: string;
	onRetry?: () => void;
	onCompact?: () => void;
}

/**
 * Normalize tool names to canonical form for rendering.
 * Handles both snake_case (canonical) and PascalCase (OAuth) names.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
	Read: 'read',
	ReadImage: 'read_image',
	Edit: 'edit',
	MultiEdit: 'multiedit',
	Write: 'write',
	CopyInto: 'copy_into',
	CopyAttachmentToProject: 'copy_attachment_to_project',
	Ls: 'ls',
	Tree: 'tree',
	Cd: 'cd',
	Pwd: 'pwd',

	Glob: 'glob',
	Grep: 'search',
	Search: 'search',

	Shell: 'shell',
	Bash: 'shell',
	bash: 'shell',
	Terminal: 'terminal',

	GitStatus: 'git_status',
	GitDiff: 'git_diff',
	GitCommit: 'git_commit',

	ApplyPatch: 'apply_patch',

	UpdateTodos: 'update_todos',
	UpdatePlan: 'update_todos',
	ProgressUpdate: 'progress_update',
	Finish: 'finish',

	WebSearch: 'websearch',

	LoadTools: 'load_tools',
	LoadMcpTools: 'load_mcp_tools',
	McpManager: 'mcp_manager',
	Simulator: 'simulator',

	Skill: 'skill',
};

function normalizeToolName(name: string): string {
	return TOOL_NAME_ALIASES[name] ?? name;
}

const COMPACT_DETAIL_TOOL_NAMES = new Set([
	'shell',
	'edit',
	'multiedit',
	'write',
	'copy_into',
	'copy_attachment_to_project',
	'apply_patch',
	'terminal',
]);

export function ToolResultRenderer({
	toolName,
	contentJson,
	toolDurationMs,
	debug,
	onNavigateToSession,
	compact,
	sessionId,
	onRetry,
	onCompact,
}: ToolResultRendererProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const normalizedName = normalizeToolName(toolName);
	const rendererCompact =
		compact && !COMPACT_DETAIL_TOOL_NAMES.has(normalizedName);

	const handleToggle = () => setIsExpanded(!isExpanded);

	const props = {
		contentJson,
		toolDurationMs: toolDurationMs ?? undefined,
		isExpanded,
		onToggle: handleToggle,
		compact: rendererCompact,
	};

	if (debug) {
		return <DebugRenderer {...props} toolName={toolName} />;
	}

	switch (normalizedName) {
		case 'read':
			return <ReadRenderer {...props} />;
		case 'read_image':
			return <ReadImageRenderer {...props} />;
		case 'edit':
		case 'multiedit':
			return <ApplyPatchRenderer {...props} toolName={normalizedName} />;
		case 'copy_into':
			return <CopyIntoRenderer {...props} />;
		case 'copy_attachment_to_project':
			return <CopyAttachmentRenderer {...props} />;
		case 'write':
			return <WriteRenderer {...props} />;
		case 'shell':
			return <BashRenderer {...props} />;
		case 'git_status':
			return <GitStatusRenderer {...props} />;
		case 'git_diff':
			return <GitDiffRenderer {...props} />;
		case 'git_commit':
			return <GitCommitRenderer {...props} />;
		case 'apply_patch':
			return <ApplyPatchRenderer {...props} />;
		case 'terminal':
			return <TerminalRenderer {...props} />;
		case 'ls':
			return <ListRenderer {...props} />;
		case 'tree':
			return <TreeRenderer {...props} />;
		case 'search':
		case 'grep':
		case 'glob':
			return <SearchRenderer {...props} />;
		case 'websearch':
			return <WebSearchRenderer {...props} />;
		case 'finish':
			return <FinishRenderer {...props} />;
		case 'update_todos':
		case 'update_plan':
			return null;
		case 'progress_update':
			return <ProgressUpdateRenderer {...props} />;
		case 'load_tools':
			return <LoadToolsRenderer {...props} />;
		case 'load_mcp_tools':
			return <LoadMcpToolsRenderer {...props} toolName={toolName} />;
		case 'mcp_manager':
			return <McpManagerRenderer {...props} />;
		case 'simulator':
			return <SimulatorRenderer {...props} />;
		case 'skill':
			return <SkillRenderer {...props} />;
		case 'error':
			return (
				<ErrorRenderer
					{...props}
					sessionId={sessionId}
					onRetry={onRetry}
					onCompact={onCompact}
				/>
			);
		case 'query_sessions':
		case 'query_messages':
		case 'search_history':
		case 'get_session_context':
		case 'get_parent_session':
		case 'present_action':
			return (
				<DatabaseToolRenderer
					toolName={toolName}
					{...props}
					onNavigateToSession={onNavigateToSession}
				/>
			);
		default:
			if (isMcpTool(normalizedName)) {
				return <McpToolRenderer {...props} toolName={toolName} />;
			}
			return <GenericRenderer {...props} toolName={toolName} />;
	}
}

export * from './types';
export { ReasoningRenderer } from './ReasoningRenderer';
