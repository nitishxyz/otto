import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './todos.txt' with { type: 'text' };

const STATUS_ENUM = z.enum([
	'pending',
	'in_progress',
	'completed',
	'cancelled',
]);

const TODO_SCHEMA = z
	.object({
		step: z
			.string()
			.min(1, 'Todo steps must be non-empty')
			.describe('Plain-text task description'),
		status: STATUS_ENUM.optional(),
	})
	.describe('Structured todo item');

type TodoItemInput = z.infer<typeof TODO_SCHEMA>;

function normalizeItems(
	raw: TodoItemInput[],
): Array<{ step: string; status: z.infer<typeof STATUS_ENUM> }> {
	const normalized = raw.map((item) => {
		const step = item.step.trim();
		const status = item.status ?? 'pending';
		return { step, status };
	});

	const filtered = normalized.filter((item) => item.step.length > 0);
	if (!filtered.length) {
		throw new Error('At least one todo item is required');
	}

	const inProgressCount = filtered.filter(
		(item) => item.status === 'in_progress',
	).length;
	if (inProgressCount > 1) {
		throw new Error('Only one todo item may be marked as in_progress');
	}

	return filtered;
}

export const updateTodosTool: Tool = tool({
	description: DESCRIPTION,
	inputSchema: z.object({
		todos: z
			.array(TODO_SCHEMA)
			.min(1)
			.describe('The complete list of todo items'),
		note: z
			.string()
			.optional()
			.describe('Optional note or context for the update'),
	}),
	async execute({ todos }: { todos: TodoItemInput[]; note?: string }) {
		const items = normalizeItems(todos);
		const remaining = items.filter(
			(item) => item.status === 'pending' || item.status === 'in_progress',
		).length;
		return {
			ok: true,
			todos: items,
			remaining,
			...(remaining > 0
				? {
						reminder:
							'Keep this list current: mark each item in_progress when you start it and completed immediately when done.',
					}
				: {}),
		};
	},
});
