import { describe, expect, test } from 'bun:test';
import {
	cleanProcessOutput,
	extractLatestTodos,
	sortShellJobs,
	sortSubagents,
	sortTerminals,
} from '../apps/tui/src/lib/activity.ts';
import type { Message, MessagePart } from '../apps/tui/src/types.ts';
import type {
	ActivityShellJob,
	ActivitySubagent,
	ActivityTerminal,
} from '../apps/tui/src/components/activity/types.ts';

function todoMessage(
	createdAt: number,
	todos: unknown[],
	note?: string,
	toolName = 'update_todos',
): Message {
	return {
		id: `message-${createdAt}`,
		createdAt,
		parts: [
			{
				id: `part-${createdAt}`,
				index: 0,
				type: 'tool_result',
				toolName,
				contentJson: { args: { todos, note } },
			} as MessagePart,
		],
	} as Message;
}

describe('TUI activity helpers', () => {
	test('extracts the latest persisted todo snapshot and normalizes statuses', () => {
		const result = extractLatestTodos([
			todoMessage(10, ['old task']),
			todoMessage(
				20,
				[
					{ step: 'done', status: 'completed' },
					{ step: 'active', status: 'in_progress' },
					{ step: 'unknown', status: 'blocked' },
				],
				'current plan',
				'UpdatePlan',
			),
		]);

		expect(result).toEqual({
			todos: [
				{ step: 'done', status: 'completed' },
				{ step: 'active', status: 'in_progress' },
				{ step: 'unknown', status: 'pending' },
			],
			note: 'current plan',
		});
	});

	test('puts running resources first and leaves inputs unchanged', () => {
		const subagents = [
			{ id: 'done', status: 'completed', updatedAt: 20 },
			{ id: 'running-old', status: 'running', updatedAt: 10 },
			{ id: 'running-new', status: 'running', updatedAt: 30 },
		] as ActivitySubagent[];
		const shells = [
			{ id: 'failed', status: 'failed', updatedAt: 30 },
			{ id: 'running', status: 'running', updatedAt: 10 },
		] as ActivityShellJob[];
		const terminals = [
			{ id: 'exited', status: 'exited', uptime: 100 },
			{ id: 'running', status: 'running', uptime: 5 },
		] as ActivityTerminal[];

		expect(sortSubagents(subagents).map((item) => item.id)).toEqual([
			'running-new',
			'running-old',
			'done',
		]);
		expect(sortShellJobs(shells).map((item) => item.id)).toEqual([
			'running',
			'failed',
		]);
		expect(sortTerminals(terminals).map((item) => item.id)).toEqual([
			'running',
			'exited',
		]);
		expect(subagents.map((item) => item.id)).toEqual([
			'done',
			'running-old',
			'running-new',
		]);
	});

	test('cleans ANSI sequences, carriage returns, and control bytes', () => {
		expect(cleanProcessOutput('\u001b[31mred\u001b[0m\r\nnext\u0007')).toBe(
			'red\nnext',
		);
	});
});
