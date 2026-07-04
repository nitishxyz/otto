import { describe, expect, test } from 'bun:test';
import { withTodoReminderPrepareStep } from '../packages/server/src/runtime/agent/runner/runner-todo-reminder.ts';
import { updateTodosTool } from '../packages/sdk/src/core/src/tools/builtin/todos.ts';

function assistantTodoCall(todos: unknown) {
	return {
		role: 'assistant',
		content: [
			{ type: 'tool-call', toolName: 'update_todos', input: { todos } },
		],
	};
}

function stepsWithoutTodoCalls(count: number) {
	return Array.from({ length: count }, () => ({
		toolCalls: [{ toolName: 'read' }],
	}));
}

describe('update_todos tool result', () => {
	test('echoes normalized todos and remaining count', async () => {
		const execute = updateTodosTool.execute as (
			input: unknown,
			options: unknown,
		) => Promise<Record<string, unknown>>;
		const result = await execute(
			{
				todos: [
					{ step: 'One', status: 'completed' },
					{ step: 'Two', status: 'in_progress' },
					'Three',
				],
			},
			{},
		);
		expect(result.ok).toBe(true);
		expect(result.remaining).toBe(2);
		expect(result.todos).toEqual([
			{ step: 'One', status: 'completed' },
			{ step: 'Two', status: 'in_progress' },
			{ step: 'Three', status: 'pending' },
		]);
		expect(typeof result.reminder).toBe('string');
	});

	test('omits reminder when all todos are closed', async () => {
		const execute = updateTodosTool.execute as (
			input: unknown,
			options: unknown,
		) => Promise<Record<string, unknown>>;
		const result = await execute(
			{ todos: [{ step: 'One', status: 'completed' }] },
			{},
		);
		expect(result.remaining).toBe(0);
		expect(result.reminder).toBeUndefined();
	});
});

describe('withTodoReminderPrepareStep', () => {
	test('injects reminder when open todos are stale', async () => {
		const prepareStep = withTodoReminderPrepareStep();
		const messages = [
			assistantTodoCall([
				{ step: 'One', status: 'in_progress' },
				{ step: 'Two', status: 'pending' },
			]),
		];
		const result = (await prepareStep({
			stepNumber: 7,
			steps: stepsWithoutTodoCalls(7),
			messages,
		})) as { messages?: Array<{ role: string; content: string }> };
		expect(result?.messages).toHaveLength(2);
		const injected = result?.messages?.at(-1);
		expect(injected?.role).toBe('user');
		expect(injected?.content).toContain('<system-reminder>');
		expect(injected?.content).toContain('2 open item(s)');
	});

	test('does not remind when todos were updated recently', async () => {
		const prepareStep = withTodoReminderPrepareStep();
		const steps = [
			...stepsWithoutTodoCalls(3),
			{ toolCalls: [{ toolName: 'update_todos' }] },
			...stepsWithoutTodoCalls(2),
		];
		const result = await prepareStep({
			stepNumber: 6,
			steps,
			messages: [assistantTodoCall([{ step: 'One', status: 'pending' }])],
		});
		expect(result).toBeUndefined();
	});

	test('does not remind when all todos are closed', async () => {
		const prepareStep = withTodoReminderPrepareStep();
		const result = await prepareStep({
			stepNumber: 10,
			steps: stepsWithoutTodoCalls(10),
			messages: [assistantTodoCall([{ step: 'One', status: 'completed' }])],
		});
		expect(result).toBeUndefined();
	});

	test('throttles repeat reminders and preserves inner result', async () => {
		const inner = () => ({ activeTools: ['read'] });
		const prepareStep = withTodoReminderPrepareStep(inner);
		const messages = [
			assistantTodoCall([{ step: 'One', status: 'in_progress' }]),
		];
		const first = (await prepareStep({
			stepNumber: 6,
			steps: stepsWithoutTodoCalls(6),
			messages,
		})) as Record<string, unknown>;
		expect(first.activeTools).toEqual(['read']);
		expect(Array.isArray(first.messages)).toBe(true);

		const second = (await prepareStep({
			stepNumber: 8,
			steps: stepsWithoutTodoCalls(8),
			messages,
		})) as Record<string, unknown>;
		expect(second.messages).toBeUndefined();
		expect(second.activeTools).toEqual(['read']);
	});
});
