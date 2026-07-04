const REMINDER_STEP_INTERVAL = 6;

const OPEN_STATUSES = new Set(['pending', 'in_progress']);

type PrepareStepArgs = {
	stepNumber: number;
	steps: unknown[];
	messages: unknown[];
};

function normalizeToolName(name: string): string {
	return name.toLowerCase().replace(/[_-]/g, '');
}

function isUpdateTodosCall(name: unknown): boolean {
	return typeof name === 'string' && normalizeToolName(name) === 'updatetodos';
}

function countOpenTodos(input: unknown): number | null {
	let value = input;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const todos = (value as Record<string, unknown>).todos;
	if (!Array.isArray(todos)) return null;
	let open = 0;
	for (const item of todos) {
		if (typeof item === 'string') {
			if (item.trim()) open += 1;
			continue;
		}
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		if (typeof record.step !== 'string' || !record.step.trim()) continue;
		const status =
			typeof record.status === 'string' ? record.status : 'pending';
		if (OPEN_STATUSES.has(status)) open += 1;
	}
	return open;
}

function findOpenTodosInMessages(messages: unknown[]): number | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: unknown; content?: unknown };
		if (message?.role !== 'assistant' || !Array.isArray(message.content)) {
			continue;
		}
		for (let j = message.content.length - 1; j >= 0; j--) {
			const part = message.content[j] as Record<string, unknown> | undefined;
			if (!part || part.type !== 'tool-call') continue;
			if (!isUpdateTodosCall(part.toolName)) continue;
			return countOpenTodos(part.input ?? part.args);
		}
	}
	return null;
}

function stepsSinceTodoUpdate(steps: unknown[]): number {
	const typed = steps as Array<{
		toolCalls?: Array<{ toolName?: string }>;
	}>;
	for (let i = typed.length - 1; i >= 0; i--) {
		const calls = typed[i]?.toolCalls;
		if (calls?.some((call) => isUpdateTodosCall(call?.toolName))) {
			return typed.length - 1 - i;
		}
	}
	return typed.length;
}

function buildReminderText(open: number): string {
	return [
		'<system-reminder>',
		`Your todo list has ${open} open item(s) and has not been updated recently. If you finished any steps, mark them completed via update_todos now and set the current step to in_progress. If the plan changed, revise the list. Do not mention this reminder in your response.`,
		'</system-reminder>',
	].join('\n');
}

/**
 * Wraps an optional prepareStep function and injects a stale-todo
 * system reminder message when the model has open todos but has not
 * called update_todos for several steps.
 */
export function withTodoReminderPrepareStep(
	inner?: (args: PrepareStepArgs) => unknown,
): (args: PrepareStepArgs) => Promise<unknown> {
	let lastReminderStep = Number.NEGATIVE_INFINITY;
	return async (args: PrepareStepArgs) => {
		const innerResult = inner ? await inner(args) : undefined;
		if (args.stepNumber - lastReminderStep < REMINDER_STEP_INTERVAL) {
			return innerResult;
		}
		if (stepsSinceTodoUpdate(args.steps) < REMINDER_STEP_INTERVAL) {
			return innerResult;
		}
		const open = findOpenTodosInMessages(args.messages);
		if (!open) return innerResult;
		lastReminderStep = args.stepNumber;
		const base =
			innerResult && typeof innerResult === 'object'
				? (innerResult as Record<string, unknown>)
				: {};
		return {
			...base,
			messages: [
				...args.messages,
				{ role: 'user', content: buildReminderText(open) },
			],
		};
	};
}
