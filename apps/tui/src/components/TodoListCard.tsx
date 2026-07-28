import { memo, useMemo } from 'react';
import { useTheme } from '../theme.ts';
import type { MessagePart } from '../types.ts';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface TodoItem {
	step: string;
	status: TodoStatus;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;
}

function normalizeStatus(value: unknown): TodoStatus {
	if (
		value === 'in_progress' ||
		value === 'completed' ||
		value === 'cancelled'
	) {
		return value;
	}
	return 'pending';
}

export function extractTodos(part: MessagePart): {
	todos: TodoItem[];
	note?: string;
} | null {
	const cj = asRecord(part.contentJson);
	if (!cj) return null;
	const args = asRecord(cj.args) ?? cj;
	const raw = args.todos;
	if (!Array.isArray(raw) || raw.length === 0) return null;

	const todos: TodoItem[] = [];
	for (const item of raw) {
		if (typeof item === 'string') {
			if (item.trim()) todos.push({ step: item.trim(), status: 'pending' });
			continue;
		}
		const rec = asRecord(item);
		const step = typeof rec?.step === 'string' ? rec.step.trim() : '';
		if (!step) continue;
		todos.push({ step, status: normalizeStatus(rec?.status) });
	}
	if (!todos.length) return null;

	const note =
		typeof args.note === 'string' && args.note.trim()
			? args.note.trim()
			: undefined;
	return { todos, note };
}

function clip(value: string, max: number): string {
	const line = value.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const TodoRow = memo(function TodoRow({ todo }: { todo: TodoItem }) {
	const { colors } = useTheme();

	const icon =
		todo.status === 'completed'
			? '✓'
			: todo.status === 'in_progress'
				? '→'
				: todo.status === 'cancelled'
					? '✕'
					: '○';
	const iconColor =
		todo.status === 'completed'
			? colors.green
			: todo.status === 'in_progress'
				? colors.yellow
				: todo.status === 'cancelled'
					? colors.fgDimmed
					: colors.fgDark;
	const textColor =
		todo.status === 'in_progress'
			? colors.fgBright
			: todo.status === 'completed'
				? colors.fgMuted
				: todo.status === 'cancelled'
					? colors.fgDimmed
					: colors.fgDark;

	return (
		<box style={{ flexDirection: 'row', gap: 1, width: '100%', height: 1 }}>
			<text style={{ flexShrink: 0 }} fg={iconColor}>
				{icon}
			</text>
			<text style={{ flexShrink: 1, overflow: 'hidden' }} fg={textColor}>
				{todo.status === 'in_progress' ? (
					<b>{clip(todo.step, 160)}</b>
				) : (
					clip(todo.step, 160)
				)}
			</text>
		</box>
	);
});

/** Compact card rendering for `update_todos` tool calls. */
export const TodoListCard = memo(function TodoListCard({
	part,
}: {
	part: MessagePart;
}) {
	const { colors } = useTheme();
	const parsed = useMemo(() => extractTodos(part), [part]);
	if (!parsed) return null;

	const { todos } = parsed;

	return (
		<box
			style={{
				flexDirection: 'column',
				width: '100%',
				paddingLeft: 1,
				paddingRight: 1,
				backgroundColor: colors.bgSubtle,
			}}
		>
			<text fg={colors.fgMuted}>
				<b>Todos</b>
			</text>
			<box style={{ flexDirection: 'column', width: '100%', paddingLeft: 1 }}>
				{todos.map((todo, i) => (
					<TodoRow key={`${i}-${todo.step.slice(0, 32)}`} todo={todo} />
				))}
			</box>
		</box>
	);
});
