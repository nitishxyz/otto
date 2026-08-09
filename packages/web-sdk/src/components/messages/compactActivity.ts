import type { MessagePart } from '../../types/api';

const EXPLORATION_TOOL_NAMES = new Set([
	'read',
	'ls',
	'tree',
	'search',
	'grep',
	'glob',
	'websearch',
	'skill',
	'query_sessions',
	'query_messages',
	'search_history',
	'get_session_context',
	'get_parent_session',
	'goal_list',
	'goal_update',
	'subagent',
	'delegate_task',
	'list_subagents',
	'message_subagent',
	'stop_subagent',
]);

interface CompactActivityEntry {
	id: string;
	label: string;
	toolName?: string;
	path?: string;
	query?: string;
	url?: string;
	fullText?: string;
	startedAt?: number | null;
	completedAt?: number | null;
}

interface CompactActivitySummary {
	title: string;
	details: string[];
}

function getPartPayload(part: MessagePart): Record<string, unknown> | null {
	if (part.contentJson && typeof part.contentJson === 'object') {
		return part.contentJson;
	}

	try {
		if (part.content) {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		}
	} catch {}

	return null;
}

function getToolArgs(part: MessagePart): Record<string, unknown> {
	const payload = getPartPayload(part);
	const args = payload?.args;
	if (args && typeof args === 'object' && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}
	return {};
}

function getToolResult(part: MessagePart): Record<string, unknown> {
	const payload = getPartPayload(part);
	const result = payload?.result;
	if (result && typeof result === 'object' && !Array.isArray(result)) {
		return result as Record<string, unknown>;
	}
	return {};
}

function truncate(value: string, max = 56): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getReasoningText(part: MessagePart): string {
	const payload = getPartPayload(part);
	const text = payload?.text;
	if (typeof text === 'string' && text.trim()) {
		return text.trim();
	}
	if (typeof part.content === 'string') {
		return part.content.trim();
	}
	return '';
}

function firstMeaningfulLine(value: string): string {
	const line = value
		.split('\n')
		.map((item) => item.trim())
		.find(Boolean);
	return line || value.trim();
}

function stripInlineMarkdown(value: string): string {
	return value
		.replace(/^Reasoning:\s*/i, '')
		.replace(/^[-*+]\s+/, '')
		.replace(/\[(.*?)\]\((.*?)\)/g, '$1')
		.replace(/[*_`#>~]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function getStringField(
	record: Record<string, unknown>,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

interface GoalUpdateTaskInput {
	id?: unknown;
	status?: unknown;
	note?: unknown;
	content?: unknown;
	sessionId?: unknown;
}

/**
 * Builds a compact label for otto's goal_update tool. The input shape is
 * otto-only: createGoal/completeGoal/addTasks plus updateTasks entries that
 * may carry a worker sessionId (dispatch).
 */
function buildGoalUpdateLabel(
	args: Record<string, unknown>,
	result: Record<string, unknown>,
): string {
	const changes = Array.isArray(result.changes)
		? result.changes.filter((item): item is string => typeof item === 'string')
		: [];
	if (changes.length) {
		return `Updated goal: ${truncate(changes.join(', '), 46)}`;
	}

	const createGoal = args.createGoal;
	if (createGoal && typeof createGoal === 'object') {
		const title = getStringField(
			createGoal as Record<string, unknown>,
			'title',
		);
		return title ? `Creating goal ${truncate(title, 36)}` : 'Creating a goal';
	}
	if (args.completeGoal === true) {
		return 'Completing goal';
	}

	const segments: string[] = [];
	const addTasks = Array.isArray(args.addTasks) ? args.addTasks : [];
	if (addTasks.length) {
		segments.push(
			`adding ${addTasks.length} task${addTasks.length === 1 ? '' : 's'}`,
		);
	}

	const updateTasks = Array.isArray(args.updateTasks)
		? (args.updateTasks as GoalUpdateTaskInput[])
		: [];
	if (updateTasks.length) {
		const statusCounts = new Map<string, number>();
		let dispatched = 0;
		for (const update of updateTasks) {
			if (typeof update !== 'object' || update === null) continue;
			if (typeof update.status === 'string') {
				statusCounts.set(
					update.status,
					(statusCounts.get(update.status) ?? 0) + 1,
				);
			}
			if (typeof update.sessionId === 'string' && update.sessionId) {
				dispatched += 1;
			}
		}
		for (const [status, count] of statusCounts) {
			segments.push(
				`${count} task${count === 1 ? '' : 's'} ${status.replace('_', ' ')}`,
			);
		}
		if (dispatched > 0) {
			segments.push(
				`dispatched ${dispatched} task${dispatched === 1 ? '' : 's'}`,
			);
		}
	}

	return segments.length
		? `Updating goal: ${truncate(segments.join(', '), 46)}`
		: 'Updating goal';
}

/**
 * Returns true when a message part represents exploratory activity that should
 * be grouped in the compact thread renderer.
 */
export function isCompactActivityPart(part: MessagePart): boolean {
	if (part.type === 'reasoning') {
		return true;
	}

	if (part.type !== 'tool_call' && part.type !== 'tool_result') {
		return false;
	}

	return Boolean(part.toolName && EXPLORATION_TOOL_NAMES.has(part.toolName));
}

/**
 * Converts a part into a compact activity entry suitable for the rolling log.
 */
export function getCompactActivityEntry(
	part: MessagePart,
): CompactActivityEntry | null {
	if (part.type === 'reasoning') {
		const rawText = getReasoningText(part);
		const reasoning = stripInlineMarkdown(firstMeaningfulLine(rawText));
		return {
			id: part.id,
			label: reasoning ? truncate(reasoning) : 'Thinking through the approach',
			toolName: 'reasoning',
			fullText: rawText || undefined,
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (!part.toolName || !EXPLORATION_TOOL_NAMES.has(part.toolName)) {
		return null;
	}

	const args = getToolArgs(part);
	const result = getToolResult(part);

	if (part.toolName === 'read') {
		const path = getStringField(result, 'path') || getStringField(args, 'path');
		return {
			id: part.id,
			toolName: part.toolName,
			path,
			label: path ? `Reading ${truncate(path)}` : 'Reading file contents',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'ls' || part.toolName === 'tree') {
		const path = getStringField(args, 'path') || getStringField(result, 'path');
		return {
			id: part.id,
			toolName: part.toolName,
			path,
			label: path ? `Scanning ${truncate(path)}` : 'Scanning the project',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (
		part.toolName === 'search' ||
		part.toolName === 'grep' ||
		part.toolName === 'glob'
	) {
		const query =
			getStringField(args, 'query', 'pattern', 'filePattern') ||
			getStringField(result, 'query', 'pattern');
		return {
			id: part.id,
			toolName: part.toolName,
			query,
			label: query ? `Searching for ${truncate(query, 42)}` : 'Searching code',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'websearch') {
		const query = getStringField(args, 'query');
		const url = getStringField(args, 'url') || getStringField(result, 'url');
		return {
			id: part.id,
			toolName: part.toolName,
			query,
			url,
			label: query
				? `Researching ${truncate(query, 42)}`
				: url
					? `Reviewing ${truncate(url, 42)}`
					: 'Researching references',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'skill') {
		const skillName = getStringField(args, 'name');
		return {
			id: part.id,
			toolName: part.toolName,
			label: skillName
				? `Loading skill ${truncate(skillName, 36)}`
				: 'Loading a skill',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'query_sessions') {
		const agent = getStringField(args, 'agent');
		const sessionType = getStringField(args, 'sessionType');
		const scope = agent
			? `${agent} sessions`
			: sessionType && sessionType !== 'main'
				? `${sessionType} sessions`
				: 'past sessions';
		return {
			id: part.id,
			toolName: part.toolName,
			label: `Searching ${scope}`,
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'query_messages') {
		const search = getStringField(args, 'search');
		const toolName = getStringField(args, 'toolName');
		return {
			id: part.id,
			toolName: part.toolName,
			query: search || toolName,
			label: search
				? `Searching messages for ${truncate(search, 42)}`
				: toolName
					? `Finding ${toolName} tool usage`
					: 'Searching session messages',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'search_history') {
		const query = getStringField(args, 'query');
		return {
			id: part.id,
			toolName: part.toolName,
			query,
			label: query
				? `Searching history for ${truncate(query, 42)}`
				: 'Searching session history',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'get_session_context') {
		const sessionId = getStringField(args, 'sessionId');
		return {
			id: part.id,
			toolName: part.toolName,
			label: sessionId
				? `Opening session ${truncate(sessionId, 12)}`
				: 'Opening session details',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'get_parent_session') {
		return {
			id: part.id,
			toolName: part.toolName,
			label: 'Opening linked session',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'goal_list') {
		const goal = getToolResult(part).goal as
			| Record<string, unknown>
			| null
			| undefined;
		const title =
			goal && typeof goal === 'object'
				? getStringField(goal, 'title')
				: undefined;
		return {
			id: part.id,
			toolName: part.toolName,
			label: title ? `Checking goal ${truncate(title, 36)}` : 'Checking goal',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'goal_update') {
		return {
			id: part.id,
			toolName: part.toolName,
			label: buildGoalUpdateLabel(args, result),
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'subagent') {
		const action = getStringField(args, 'action');
		if (action === 'delegate') {
			const agent =
				getStringField(args, 'agent') || getStringField(result, 'agent');
			const task = getStringField(args, 'task');
			return {
				id: part.id,
				toolName: part.toolName,
				label: agent
					? `Delegating to ${agent}${task ? `: ${truncate(task, 34)}` : ''}`
					: 'Delegating sub-agent task',
				startedAt: part.startedAt,
				completedAt: part.completedAt,
			};
		}
		if (action === 'message') {
			const message = getStringField(args, 'message');
			const delivery = getStringField(args, 'delivery');
			return {
				id: part.id,
				toolName: part.toolName,
				label: message
					? `${delivery === 'interrupt' ? 'Interrupting' : 'Following up with'} sub-agent: ${truncate(message, 42)}`
					: 'Following up with sub-agent',
				startedAt: part.startedAt,
				completedAt: part.completedAt,
			};
		}
		if (action === 'list') {
			const subagents = Array.isArray(result.subagents) ? result.subagents : [];
			return {
				id: part.id,
				toolName: part.toolName,
				label: subagents.length
					? `Checking ${subagents.length} sub-agent${subagents.length === 1 ? '' : 's'}`
					: 'Checking sub-agents',
				startedAt: part.startedAt,
				completedAt: part.completedAt,
			};
		}
		const actionLabels: Record<string, string> = {
			status: 'Checking sub-agent status',
			read: 'Reading sub-agent activity',
			compact: 'Compacting sub-agent context',
			retry: 'Retrying sub-agent',
			stop: 'Stopping sub-agent',
		};
		return {
			id: part.id,
			toolName: part.toolName,
			label: (action && actionLabels[action]) || 'Managing sub-agent',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'delegate_task') {
		const agent =
			getStringField(args, 'agent') || getStringField(result, 'agent');
		const task = getStringField(args, 'task');
		return {
			id: part.id,
			toolName: part.toolName,
			label: agent
				? `Delegating to ${agent}${task ? `: ${truncate(task, 34)}` : ''}`
				: 'Delegating sub-agent task',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'message_subagent') {
		const message = getStringField(args, 'message');
		const delivery = getStringField(args, 'delivery');
		return {
			id: part.id,
			toolName: part.toolName,
			label: message
				? `${delivery === 'interrupt' ? 'Interrupting' : 'Following up with'} sub-agent: ${truncate(message, 42)}`
				: delivery === 'interrupt'
					? 'Interrupting sub-agent'
					: 'Following up with sub-agent',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'stop_subagent') {
		return {
			id: part.id,
			toolName: part.toolName,
			label: 'Stopping sub-agent',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	if (part.toolName === 'list_subagents') {
		const subagents = Array.isArray(result.subagents) ? result.subagents : [];
		return {
			id: part.id,
			toolName: part.toolName,
			label: subagents.length
				? `Checking ${subagents.length} sub-agent${subagents.length === 1 ? '' : 's'}`
				: 'Checking sub-agents',
			startedAt: part.startedAt,
			completedAt: part.completedAt,
		};
	}

	return {
		id: part.id,
		toolName: part.toolName,
		label: 'Searching session history',
		startedAt: part.startedAt,
		completedAt: part.completedAt,
	};
}

/**
 * Builds compact activity entries while de-duplicating completed tool calls.
 */
export function buildCompactActivityEntries(
	parts: MessagePart[],
): CompactActivityEntry[] {
	const latestToolResults = new Map<string, MessagePart>();

	for (const part of parts) {
		if (part.type === 'tool_result' && part.toolCallId) {
			latestToolResults.set(part.toolCallId, part);
		}
	}

	const entries: CompactActivityEntry[] = [];

	for (const part of parts) {
		if (
			part.type === 'tool_call' &&
			part.toolCallId &&
			latestToolResults.has(part.toolCallId)
		) {
			continue;
		}

		// Cached per part: entry objects then keep their identity across
		// rebuilds, so a grouped activity row only changes when one of its own
		// parts changed.
		const entry = getCachedCompactActivityEntry(part);
		if (entry) {
			entries.push(entry);
		}
	}

	return entries;
}

function collectReferencedFiles(entries: CompactActivityEntry[]): Set<string> {
	const files = new Set<string>();

	for (const entry of entries) {
		if (entry.path) {
			files.add(entry.path);
		}
	}

	return files;
}

function computeElapsedMs(entries: CompactActivityEntry[]): number | null {
	let earliest: number | null = null;
	let latest: number | null = null;

	for (const entry of entries) {
		const start = entry.startedAt ?? null;
		const end = entry.completedAt ?? entry.startedAt ?? null;
		if (start !== null && (earliest === null || start < earliest)) {
			earliest = start;
		}
		if (end !== null && (latest === null || end > latest)) {
			latest = end;
		}
	}

	if (earliest !== null && latest !== null && latest > earliest) {
		return latest - earliest;
	}
	return null;
}

function formatDuration(ms: number): string {
	const secs = Math.round(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const rem = secs % 60;
	return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

/**
 * Summarizes a rolling sequence of exploratory activity for the compact UI.
 */
export function summarizeCompactActivities(
	entries: CompactActivityEntry[],
): CompactActivitySummary {
	const files = collectReferencedFiles(entries);
	let searches = 0;
	let scans = 0;
	let webLookups = 0;
	let reasoning = 0;
	let historyLookups = 0;
	let goalUpdates = 0;
	let subagentOps = 0;

	for (const entry of entries) {
		switch (entry.toolName) {
			case 'reasoning':
				reasoning += 1;
				break;
			case 'read':
				break;
			case 'ls':
			case 'tree':
				scans += 1;
				break;
			case 'search':
			case 'grep':
			case 'glob':
				searches += 1;
				break;
			case 'websearch':
				webLookups += 1;
				break;
			case 'skill':
			case 'query_sessions':
			case 'query_messages':
			case 'search_history':
			case 'get_session_context':
			case 'get_parent_session':
				historyLookups += 1;
				break;
			case 'goal_list':
			case 'goal_update':
				goalUpdates += 1;
				break;
			case 'subagent':
			case 'delegate_task':
			case 'list_subagents':
			case 'message_subagent':
			case 'stop_subagent':
			case 'retry_subagent':
				subagentOps += 1;
				break;
		}
	}
	const hasProjectReview = files.size > 0 || scans > 0;
	const elapsedMs = computeElapsedMs(entries);
	const durationStr = elapsedMs !== null ? formatDuration(elapsedMs) : null;

	const isReasoningOnly =
		reasoning > 0 &&
		files.size === 0 &&
		searches === 0 &&
		scans === 0 &&
		webLookups === 0 &&
		historyLookups === 0 &&
		goalUpdates === 0 &&
		subagentOps === 0;

	const title = isReasoningOnly
		? durationStr
			? `Thought for ${durationStr}`
			: 'Thought through the approach'
		: goalUpdates > 0 && subagentOps > 0
			? 'Tracked goals and sub-agents'
			: goalUpdates > 0
				? 'Updated goal progress'
				: subagentOps > 0
					? 'Managed sub-agents'
					: webLookups > 0
						? hasProjectReview || searches > 0
							? 'Researched and reviewed the project'
							: 'Researched references'
						: historyLookups > 0 && searches > 0
							? 'Searched history and code'
							: hasProjectReview && searches > 0
								? 'Reviewed files and searched code'
								: scans > 0
									? 'Explored project structure'
									: files.size > 0
										? 'Reviewed project files'
										: historyLookups > 0
											? 'Searched session history'
											: 'Thought through the approach';

	const details: string[] = [];
	if (!isReasoningOnly && durationStr) {
		details.push(durationStr);
	}
	if (files.size > 0) {
		details.push(`${files.size} ${files.size === 1 ? 'file' : 'files'}`);
	}
	if (searches > 0) {
		details.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`);
	}
	if (scans > 0 && files.size === 0) {
		details.push(`${scans} ${scans === 1 ? 'scan' : 'scans'}`);
	}
	if (webLookups > 0) {
		details.push(
			`${webLookups} ${webLookups === 1 ? 'web lookup' : 'web lookups'}`,
		);
	}
	if (historyLookups > 0 && title !== 'Searched session history') {
		details.push('session history');
	}
	if (goalUpdates > 0 && !title.includes('goal')) {
		details.push(
			`${goalUpdates} goal ${goalUpdates === 1 ? 'update' : 'updates'}`,
		);
	}
	if (subagentOps > 0 && !title.includes('sub-agent')) {
		details.push(
			`${subagentOps} sub-agent ${subagentOps === 1 ? 'step' : 'steps'}`,
		);
	}
	if (reasoning > 0 && !isReasoningOnly) {
		details.push('reasoning');
	}
	if (details.length === 0 && reasoning === 0) {
		details.push(
			`${entries.length} ${entries.length === 1 ? 'step' : 'steps'}`,
		);
	}

	return { title, details };
}

/**
 * Per-part entry cache. The compact thread derives entries on every row
 * rebuild; memoizing on the part object keeps entry identity (and therefore
 * LegendList measurements) stable, because parts are replaced rather than
 * mutated on every stream update.
 */
const compactActivityEntryCache = new WeakMap<
	MessagePart,
	CompactActivityEntry | null
>();

/** Memoized {@link getCompactActivityEntry} keyed on part identity. */
export function getCachedCompactActivityEntry(
	part: MessagePart,
): CompactActivityEntry | null {
	const cached = compactActivityEntryCache.get(part);
	if (cached !== undefined) return cached;
	const entry = getCompactActivityEntry(part);
	compactActivityEntryCache.set(part, entry);
	return entry;
}

export type { CompactActivityEntry, CompactActivitySummary };
