import type { Message, MessagePart } from '../types.ts';
import type {
	ActivityShellJob,
	ActivitySubagent,
	ActivityTodo,
	ActivityTodoSnapshot,
	ActivityTerminal,
} from '../components/activity/types.ts';

const ANSI_RE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape bytes are intentional
	/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control bytes are intentional
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Removes terminal formatting and unsafe control bytes from captured output. */
export function cleanProcessOutput(raw: string): string {
	return raw
		.replace(ANSI_RE, '')
		.replace(CONTROL_RE, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeTodoStatus(value: unknown): ActivityTodo['status'] {
	return value === 'in_progress' ||
		value === 'completed' ||
		value === 'cancelled'
		? value
		: 'pending';
}

function todoSnapshotFromPart(part: MessagePart): ActivityTodoSnapshot | null {
	const content = asRecord(part.contentJson);
	const args = asRecord(content?.args) ?? content;
	if (!args || !Array.isArray(args.todos)) return null;
	const todos: ActivityTodo[] = [];
	for (const value of args.todos) {
		if (typeof value === 'string' && value.trim()) {
			todos.push({ step: value.trim(), status: 'pending' });
			continue;
		}
		const item = asRecord(value);
		const step = typeof item?.step === 'string' ? item.step.trim() : '';
		if (step) todos.push({ step, status: normalizeTodoStatus(item?.status) });
	}
	if (!todos.length) return null;
	return {
		todos,
		note:
			typeof args.note === 'string' && args.note.trim()
				? args.note.trim()
				: undefined,
	};
}

/** Returns the newest todo snapshot persisted in the visible session messages. */
export function extractLatestTodos(
	messages: Message[],
): ActivityTodoSnapshot | null {
	const ordered = [...messages].sort((a, b) => b.createdAt - a.createdAt);
	for (const message of ordered) {
		const parts = [...(message.parts ?? [])].sort(
			(a, b) => (b.index ?? 0) - (a.index ?? 0),
		);
		for (const part of parts) {
			const name = part.toolName?.toLowerCase().replaceAll('_', '');
			if (name !== 'updatetodos' && name !== 'updateplan') continue;
			const snapshot = todoSnapshotFromPart(part);
			if (snapshot) return snapshot;
		}
	}
	return null;
}

const STATUS_RANK: Record<string, number> = {
	running: 0,
	in_progress: 0,
	pending: 1,
	failed: 2,
	cancelled: 3,
	completed: 4,
	exited: 4,
};

function byStatusThenRecent<T extends { status: string; updatedAt?: number }>(
	a: T,
	b: T,
): number {
	const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
	return rank || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

export function sortSubagents(items: ActivitySubagent[]): ActivitySubagent[] {
	return [...items].sort(byStatusThenRecent);
}

export function sortShellJobs(items: ActivityShellJob[]): ActivityShellJob[] {
	return [...items].sort(byStatusThenRecent);
}

export function sortTerminals(items: ActivityTerminal[]): ActivityTerminal[] {
	return [...items].sort((a, b) => {
		const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
		if (rank) return rank;
		return b.uptime - a.uptime;
	});
}
