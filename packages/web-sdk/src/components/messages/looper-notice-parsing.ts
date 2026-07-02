export const LOOPER_KICKOFF_TAG = '<looper_kickoff';
export const LOOPER_WAKEUP_TAG = '<looper_wakeup';
// Legacy tags from before the otto -> looper agent rename; old transcripts
// still contain them.
const LEGACY_KICKOFF_TAG = '<otto_kickoff';
const LEGACY_WAKEUP_TAG = '<otto_wakeup';

/** True when a message is the automated looper goal-kickoff payload. */
export function isLooperKickoffMessage(content: string): boolean {
	const trimmed = content.trimStart();
	return (
		trimmed.startsWith(LOOPER_KICKOFF_TAG) ||
		trimmed.startsWith(LEGACY_KICKOFF_TAG)
	);
}

/** True when a message is the automated looper wakeup/check-in payload. */
export function isLooperWakeupMessage(content: string): boolean {
	const trimmed = content.trimStart();
	return (
		trimmed.startsWith(LOOPER_WAKEUP_TAG) ||
		trimmed.startsWith(LEGACY_WAKEUP_TAG)
	);
}

export interface LooperNoticeTask {
	id: string;
	status: string;
	position: number;
	content: string;
	note?: string;
	workerSessionId?: string;
}

export interface LooperKickoffData {
	goalId: string;
	title: string;
	tasks: LooperNoticeTask[];
	instructions: string;
}

export interface LooperWakeupSubagent {
	agent: string;
	status: string;
	delivered?: boolean;
	note?: string;
}

export interface LooperWakeupData {
	workerSessionId: string;
	workerAgent: string;
	errored: boolean;
	errorReason?: string;
	goalId?: string;
	goalTitle?: string;
	tasks: LooperNoticeTask[];
	transcript: string[];
	subagents: LooperWakeupSubagent[];
	instructions: string;
}

const TASK_RE = /<task\b([^>]*)>([\s\S]*?)<\/task>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;
const SUBAGENT_RE = /<subagent\b([^>]*)\/>/g;

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(ATTR_RE)) {
		attrs[match[1]] = match[2];
	}
	return attrs;
}

function parseTasks(block: string): LooperNoticeTask[] {
	const tasks: LooperNoticeTask[] = [];
	for (const match of block.matchAll(TASK_RE)) {
		const attrs = parseAttrs(match[1] ?? '');
		const body = match[2] ?? '';
		const note = /<note>([\s\S]*?)<\/note>/.exec(body)?.[1]?.trim();
		const content = body.replace(/<note>[\s\S]*?<\/note>/, '').trim();
		tasks.push({
			id: attrs.id ?? '',
			status: attrs.status ?? 'pending',
			position: Number.parseInt(attrs.position ?? '0', 10) || 0,
			content,
			note,
			workerSessionId: attrs['worker-session-id'],
		});
	}
	return tasks.sort((a, b) => a.position - b.position);
}

function extractBlock(content: string, tag: string): string {
	return (
		new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(content)?.[1] ??
		''
	);
}

/** Parses the `<looper_kickoff>` (or legacy `<otto_kickoff>`) payload. */
export function parseLooperKickoff(content: string): LooperKickoffData {
	const goalId =
		/<(?:looper|otto)_kickoff\s+goal-id="([^"]*)"/.exec(content)?.[1] ?? '';
	const title = /<title>([\s\S]*?)<\/title>/.exec(content)?.[1]?.trim() ?? '';
	const tasks = parseTasks(extractBlock(content, 'tasks'));
	const instructions = extractBlock(content, 'instructions').trim();
	return { goalId, title, tasks, instructions };
}

/** Parses the `<looper_wakeup>` (or legacy `<otto_wakeup>`) payload. */
export function parseLooperWakeup(content: string): LooperWakeupData {
	const headAttrs = parseAttrs(
		/<(?:looper|otto)_wakeup\b([^>]*)>/.exec(content)?.[1] ?? '',
	);
	const lastRun = headAttrs['last-run'] ?? 'completed';
	const errored = lastRun.startsWith('errored');
	const errorReason = errored
		? lastRun.slice('errored:'.length) || undefined
		: undefined;

	const goalBlock = extractBlock(content, 'goal');
	const goalId = /<goal\s+id="([^"]*)"/.exec(content)?.[1];
	const goalTitle = /<title>([\s\S]*?)<\/title>/.exec(goalBlock)?.[1]?.trim();
	const tasks = parseTasks(extractBlock(goalBlock, 'tasks'));

	const transcriptBlock = extractBlock(content, 'transcript');
	const transcript = transcriptBlock
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	const subagentsBlock = extractBlock(content, 'subagents');
	const subagents: LooperWakeupSubagent[] = [];
	for (const match of subagentsBlock.matchAll(SUBAGENT_RE)) {
		const attrs = parseAttrs(match[1] ?? '');
		subagents.push({
			agent: attrs.agent ?? '',
			status: attrs.status ?? '',
			delivered:
				attrs.delivered === undefined ? undefined : attrs.delivered === 'true',
			note: attrs.note,
		});
	}

	const instructions = extractBlock(content, 'instructions').trim();

	return {
		workerSessionId: headAttrs['worker-session-id'] ?? '',
		workerAgent: headAttrs['worker-agent'] ?? '',
		errored,
		errorReason,
		goalId,
		goalTitle,
		tasks,
		transcript,
		subagents,
		instructions,
	};
}
