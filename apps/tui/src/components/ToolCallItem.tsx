import { memo } from 'react';
import { useTheme } from '../theme.ts';
import { DiffView } from './DiffView.tsx';
import type { MessagePart } from '../types.ts';

const DIFF_TOOLS = new Set([
	'write',
	'edit',
	'multiedit',
	'copy_into',
	'apply_patch',
]);

interface ToolCallItemProps {
	part: MessagePart;
}

function clip(value: string, max = 120): string {
	const line = value.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function str(v: unknown): string | null {
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;
}

const PATCH_FILE_RE =
	/\*\*\*\s+(?:Update File|Add File|Delete File|Replace in|Delete Lines in|Replace Lines in|Insert Before in|Insert After in):\s*(.+)/;

const TOOL_NAME_ALIASES: Record<string, string> = {
	readimage: 'read_image',
	copyinto: 'copy_into',
	copyattachmenttoproject: 'copy_attachment_to_project',
	gitstatus: 'git_status',
	gitdiff: 'git_diff',
	gitcommit: 'git_commit',
	applypatch: 'apply_patch',
	updatetodos: 'update_todos',
	updateplan: 'update_plan',
	progressupdate: 'progress_update',
	loadtools: 'load_tools',
	loadmcptools: 'load_mcp_tools',
	mcpmanager: 'mcp_manager',
};

function normalizeToolName(name: string | null): string {
	const lower = (name || '').toLowerCase();
	return TOOL_NAME_ALIASES[lower] ?? lower;
}

function countItems(value: unknown): number | null {
	return Array.isArray(value) ? value.length : null;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function formatBytes(bytes: number | null): string | null {
	if (bytes === null) return null;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function summarizePatch(patch: string): string {
	let files = 0;
	let additions = 0;
	let deletions = 0;
	for (const line of patch.split('\n')) {
		if (line.startsWith('diff --git')) files += 1;
		else if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
		else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
	}
	if (!files && !additions && !deletions) return 'no changes';
	return [
		files ? plural(files, 'file') : null,
		additions ? `+${additions}` : null,
		deletions ? `-${deletions}` : null,
	]
		.filter(Boolean)
		.join(' ');
}

function mcpActionLabel(action: string | null): string {
	switch (action) {
		case 'list':
			return 'list servers';
		case 'add':
			return 'add server';
		case 'update':
			return 'update server';
		case 'remove':
			return 'remove server';
		case 'enable':
			return 'enable server';
		case 'disable':
			return 'disable server';
		default:
			return action?.replace(/_/g, ' ') || 'mcp manager';
	}
}

function simulatorActionLabel(action: string | null): string {
	switch (action) {
		case 'start':
			return 'start preview';
		case 'take_screenshot':
			return 'screenshot';
		case 'type':
		case 'paste':
			return 'type text';
		case 'accessibility_tree':
			return 'accessibility tree';
		case 'open_url':
			return 'open URL';
		case 'list_apps':
			return 'list apps';
		default:
			return action?.replace(/_/g, ' ') || 'simulator';
	}
}

function getToolSummary(part: MessagePart): string | null {
	const cj = part.contentJson as Record<string, unknown> | undefined;
	if (!cj) return null;
	const args = asRecord(cj.args);
	const result = asRecord(cj.result);
	const src = args ?? cj;
	const name = normalizeToolName(part.toolName);

	switch (name) {
		case 'shell':
		case 'bash': {
			const cmd = str(src.cmd) ?? str(src.command);
			return cmd ? clip(cmd) : null;
		}
		case 'ls':
		case 'pwd':
		case 'cd': {
			return clip(str(src.path) ?? '.');
		}
		case 'tree': {
			const path = str(src.path) ?? '.';
			const depth = num(src.depth);
			return clip(depth !== null ? `${path} (depth ${depth})` : path);
		}
		case 'glob': {
			const pattern = str(src.pattern);
			const path = str(src.path);
			if (!pattern) return path ? clip(path) : null;
			return clip(path ? `${pattern} in ${path}` : pattern);
		}
		case 'search':
		case 'grep': {
			const query = str(src.query) ?? str(src.pattern);
			if (!query) return null;
			const path = str(src.path);
			const glob = Array.isArray(src.glob)
				? src.glob.filter((g) => typeof g === 'string').join(',')
				: str(src.glob);
			let scope = path && path !== '.' ? ` in ${path}` : '';
			if (glob) scope += ` [${glob}]`;
			return clip(`"${query}"${scope}`);
		}
		case 'read':
		case 'read_image': {
			const path = str(src.path) ?? str(src.filePath) ?? str(src.file);
			if (!path) return null;
			const start = num(src.startLine);
			const end = num(src.endLine);
			if (start !== null && end !== null)
				return clip(`${path}:${start}-${end}`);
			if (start !== null) return clip(`${path}:${start}`);
			return clip(path);
		}
		case 'write':
		case 'edit':
		case 'multiedit': {
			const path = str(src.path) ?? str(src.filePath) ?? str(src.file);
			return path ? clip(path) : null;
		}
		case 'copy_into': {
			const sourcePath = str(src.sourcePath);
			const targetPath = str(src.targetPath);
			if (sourcePath && targetPath)
				return clip(`${sourcePath} → ${targetPath}`);
			const single = targetPath ?? sourcePath;
			return single ? clip(single) : null;
		}
		case 'copy_attachment_to_project': {
			const path =
				(result ? str(result.path) : null) ??
				str(src.targetPath) ??
				str(src.path);
			const filename = result ? str(result.filename) : null;
			const bytes = result ? formatBytes(num(result.bytes)) : null;
			const detail = [path ?? filename, bytes].filter(Boolean).join(' ');
			return detail ? clip(detail) : null;
		}
		case 'apply_patch': {
			const path = str(src.path) ?? str(src.filePath);
			if (path) return clip(path);
			const patch = str(src.patch);
			const fromPatch = patch ? PATCH_FILE_RE.exec(patch)?.[1] : null;
			return fromPatch ? clip(fromPatch) : null;
		}
		case 'git_status': {
			if (!result) return null;
			const staged = num(result.staged) ?? 0;
			const unstaged = num(result.unstaged) ?? 0;
			if (!staged && !unstaged) return 'clean';
			return [
				staged ? `${staged} staged` : null,
				unstaged ? `${unstaged} unstaged` : null,
			]
				.filter(Boolean)
				.join(', ');
		}
		case 'git_diff': {
			const patch = result ? (str(result.patch) ?? str(result.diff)) : null;
			const scope = src.all || result?.all ? 'all ' : '';
			return patch
				? clip(`${scope}${summarizePatch(patch)}`)
				: `${scope}no changes`;
		}
		case 'terminal': {
			const op = str(src.operation);
			const detail = str(src.command) ?? str(src.terminalId);
			const segments = [op, detail].filter(Boolean) as string[];
			return segments.length ? clip(segments.join(' ')) : null;
		}
		case 'mcp_manager': {
			const action = (result ? str(result.action) : null) ?? str(src.action);
			const servers = result ? countItems(result.servers) : null;
			const server = result ? asRecord(result.server) : undefined;
			const detail =
				action === 'list' && servers !== null
					? plural(servers, 'server')
					: ((server ? str(server.name) : null) ??
						(result ? str(result.name) : null) ??
						str(src.name));
			return clip([mcpActionLabel(action), detail].filter(Boolean).join(' '));
		}
		case 'simulator': {
			const action = str(src.action);
			const foreground = result ? asRecord(result.foreground) : undefined;
			const stream = result ? asRecord(result.stream) : undefined;
			const detail =
				(result ? str(result.path) : null) ??
				(result ? str(result.previewUrl) : null) ??
				str(stream?.url) ??
				(result ? str(result.bundleId) : null) ??
				str(foreground?.bundleId) ??
				str(src.bundleId) ??
				str(src.url) ??
				(countItems(result?.apps) !== null
					? plural(countItems(result?.apps) ?? 0, 'app')
					: null);
			return clip(
				[simulatorActionLabel(action), detail].filter(Boolean).join(' '),
			);
		}
		case 'websearch':
		case 'web_search': {
			const query = str(src.query);
			if (query) return clip(`"${query}"`);
			const url = str(src.url);
			return url ? clip(url) : null;
		}
		case 'query_sessions': {
			const sessions = result ? countItems(result.sessions) : null;
			const total = result ? num(result.total) : null;
			if (sessions !== null)
				return clip(
					`${plural(sessions, 'session')}${total ? ` of ${total}` : ''}`,
				);
			return str(src.agent) ?? str(src.sessionType) ?? null;
		}
		case 'query_messages': {
			const messages = result ? countItems(result.messages) : null;
			if (messages !== null) return plural(messages, 'message');
			return str(src.search) ?? str(src.sessionId) ?? null;
		}
		case 'search_history': {
			const results = result ? countItems(result.results) : null;
			const query = str(src.query);
			if (results !== null)
				return clip(
					`${plural(results, 'result')}${query ? ` for "${query}"` : ''}`,
				);
			return query ? clip(`"${query}"`) : null;
		}
		case 'get_session_context':
		case 'get_parent_session': {
			const session = result
				? (asRecord(result.session) ?? asRecord(result.parentSession))
				: undefined;
			return (
				(session ? (str(session.title) ?? str(session.id)) : null) ??
				str(src.sessionId)
			);
		}
		case 'present_action': {
			const links = result ? countItems(result.links) : null;
			return (
				str(result?.title) ?? (links !== null ? plural(links, 'session') : null)
			);
		}
		case 'goal_list':
		case 'goal_update': {
			const goal = result ? asRecord(result.goal) : undefined;
			const tasks = result ? countItems(result.tasks) : null;
			const title = goal ? str(goal.title) : null;
			return title ?? (tasks !== null ? plural(tasks, 'task') : null);
		}
		case 'delegate_task': {
			const agent = str(src.agent) ?? (result ? str(result.agent) : null);
			const task = str(src.task);
			if (agent && task) return clip(`${agent}: ${task}`);
			const single = agent ?? task;
			return single ? clip(single) : null;
		}
		case 'message_subagent': {
			const id = str(src.subagentId);
			const message = str(src.message);
			const agent = result ? str(result.agent) : null;
			const head = agent ?? (id ? `${id.slice(0, 8)}…` : null);
			if (head && message) return clip(`${head}: ${message}`);
			const single = message ?? head;
			return single ? clip(single) : null;
		}
		case 'list_subagents': {
			const subagents = result?.subagents;
			if (Array.isArray(subagents)) {
				const running = subagents.filter(
					(s) => asRecord(s)?.status === 'running',
				).length;
				const count = subagents.length;
				return clip(
					`${count} sub-agent${count === 1 ? '' : 's'}${running ? `, ${running} running` : ''}`,
				);
			}
			const status = str(src.status);
			return status ? clip(status) : null;
		}
		case 'skill': {
			const skillName = str(src.name);
			const file = str(src.file);
			if (skillName && file) return clip(`${skillName} (${file})`);
			return skillName ? clip(skillName) : null;
		}
		case 'load_tools':
		case 'load_mcp_tools': {
			const tools = Array.isArray(src.tools)
				? src.tools.filter((t) => typeof t === 'string').join(', ')
				: null;
			return tools ? clip(tools) : null;
		}
		case 'git_commit': {
			const message = str(src.message);
			return message ? clip(message.split('\n')[0] ?? message) : null;
		}
	}

	for (const key of [
		'path',
		'targetPath',
		'filePath',
		'file',
		'pattern',
		'query',
		'url',
		'cmd',
		'command',
		'message',
		'name',
	]) {
		const val = str(src[key]);
		if (val) return clip(val);
	}

	return null;
}

function extractDiffPatch(part: MessagePart): string | null {
	if (!DIFF_TOOLS.has(part.toolName || '')) return null;
	if (part.type !== 'tool_result' && !part.completedAt) return null;

	const cj = part.contentJson as Record<string, unknown> | undefined;
	if (!cj) return null;

	const artifact = cj.artifact as { kind?: string; patch?: string } | undefined;
	if (artifact?.kind === 'file_diff' && typeof artifact.patch === 'string') {
		return artifact.patch;
	}

	const result = cj.result as
		| { artifact?: { kind?: string; patch?: string } }
		| undefined;
	if (
		result?.artifact?.kind === 'file_diff' &&
		typeof result.artifact.patch === 'string'
	) {
		return result.artifact.patch;
	}

	return null;
}

function extractFilePath(part: MessagePart): string | undefined {
	const cj = part.contentJson as Record<string, unknown> | undefined;
	if (!cj) return undefined;

	const args = cj.args as Record<string, unknown> | undefined;
	const result = cj.result as Record<string, unknown> | undefined;

	for (const src of [args, result, cj]) {
		if (!src) continue;
		for (const key of ['path', 'filePath', 'file']) {
			const val = src[key];
			if (typeof val === 'string' && val.trim()) return val.trim();
		}
	}

	return undefined;
}

function extractToolError(part: MessagePart): string | null {
	if (part.type === 'error') return null;
	const cj = part.contentJson as Record<string, unknown> | undefined;
	if (!cj) return null;

	if (typeof cj.error === 'string') return cj.error;

	const result = cj.result as Record<string, unknown> | undefined;
	if (
		result &&
		typeof result === 'object' &&
		'ok' in result &&
		result.ok === false
	) {
		if (typeof result.error === 'string') return result.error;
		return 'Tool execution failed';
	}

	return null;
}

export const ToolCallItem = memo(function ToolCallItem({
	part,
}: ToolCallItemProps) {
	const { colors } = useTheme();
	const toolName = part.toolName || 'unknown';
	const target = getToolSummary(part);
	const isResult = part.type === 'tool_result';
	const isCompleted = isResult || !!part.completedAt;
	const toolError = extractToolError(part);
	const hasError = part.type === 'error' || !!toolError;
	const duration = part.toolDurationMs;
	const displayName = toolName.includes('__')
		? toolName.replace('__', ' > ')
		: toolName;

	const icon = hasError ? '✗' : isCompleted ? '✓' : '→';
	const iconColor = hasError
		? colors.red
		: isCompleted
			? colors.green
			: colors.fgDark;
	const nameColor = hasError
		? colors.red
		: isCompleted
			? colors.fgMuted
			: colors.fgDark;

	const durationStr = duration
		? duration < 1000
			? `${duration}ms`
			: `${(duration / 1000).toFixed(1)}s`
		: '';

	const maxErrorLen = Math.max(20, 60 - displayName.length);
	const truncatedError =
		hasError && toolError
			? toolError.length > maxErrorLen
				? `${toolError.slice(0, maxErrorLen - 1)}…`
				: toolError
			: '';

	const diffPatch = extractDiffPatch(part);
	const filePath = extractFilePath(part);

	return (
		<box
			style={{
				flexDirection: 'column',
				width: '100%',
			}}
		>
			<box
				style={{
					flexDirection: 'row',
					gap: 1,
					paddingLeft: 2,
					height: 1,
					width: '100%',
					backgroundColor: colors.toolBg,
					overflow: 'hidden',
				}}
			>
				<text style={{ flexShrink: 0 }} fg={iconColor}>
					{icon}
				</text>
				<text style={{ flexShrink: 0 }} fg={nameColor}>
					{displayName}
				</text>
				{hasError && truncatedError ? (
					<text style={{ flexShrink: 0 }} fg={colors.red}>
						{truncatedError}
					</text>
				) : null}
				{hasError && durationStr ? (
					<text style={{ flexShrink: 0 }} fg={colors.fgDimmed}>
						{durationStr}
					</text>
				) : null}
				{!hasError && target && (
					<text
						style={{ flexShrink: 1, overflow: 'hidden' }}
						fg={colors.toolArgs}
					>
						{target}
					</text>
				)}
				{!hasError && durationStr ? (
					<text style={{ flexShrink: 0 }} fg={colors.fgDimmed}>
						{durationStr}
					</text>
				) : null}
			</box>
			{diffPatch && <DiffView patch={diffPatch} filePath={filePath} />}
		</box>
	);
});
