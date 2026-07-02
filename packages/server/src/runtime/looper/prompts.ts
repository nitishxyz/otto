import { eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { buildRecentTranscript } from './transcript.ts';
import type { GoalRow, GoalTaskRow, SessionRow } from './types.ts';

/**
 * Builds the kickoff message dispatched into a goal's looper session when the
 * user starts the goal. Looper plans dispatch from here. Wrapped in
 * <looper_kickoff> so clients render it as structured UI instead of raw text.
 */
export function buildGoalKickoffMessage(
	goal: GoalRow,
	tasks: GoalTaskRow[],
): string {
	const lines: string[] = [
		`<looper_kickoff goal-id="${goal.id}">`,
		`<title>${goal.title}</title>`,
	];
	if (tasks.length) {
		lines.push('<tasks>');
		for (const task of tasks) {
			lines.push(
				`<task id="${task.id}" status="${task.status}" position="${task.position}">${task.content}${task.note ? ` <note>${task.note}</note>` : ''}</task>`,
			);
		}
		lines.push('</tasks>');
	} else {
		lines.push('<tasks />');
	}
	if (goal.sessionId) {
		lines.push(
			`<legacy-worker-session>${goal.sessionId}</legacy-worker-session>`,
		);
	}
	lines.push(
		'<instructions>',
		'The user started this goal. You orchestrate it.',
		tasks.length
			? 'Dispatch the first open task(s): mark them in_progress via goal_update (recording the worker sessionId), then delegate with delegate_task or enqueue into a worker session. Independent tasks may run in parallel.'
			: 'The goal has no tasks yet. Create them with goal_update.',
		'</instructions>',
		'</looper_kickoff>',
	);
	return lines.join('\n');
}

/**
 * Builds the wakeup message dispatched into looper when a worker session run
 * finishes. Wrapped in <looper_wakeup> for structured client rendering.
 */
export async function buildLooperWakeMessage(args: {
	db: DB;
	workerSession: SessionRow;
	goal: GoalRow | undefined;
	tasks: GoalTaskRow[];
	errored: boolean;
	lastRunFinishReason: string | null;
}): Promise<string> {
	const lastRun = args.errored
		? `errored:${args.lastRunFinishReason ?? 'unknown'}`
		: 'completed';
	const lines: string[] = [
		`<looper_wakeup worker-session-id="${args.workerSession.id}" worker-agent="${args.workerSession.agent}" last-run="${lastRun}">`,
	];

	if (args.goal) {
		lines.push(`<goal id="${args.goal.id}"><title>${args.goal.title}</title>`);
		if (args.tasks.length) {
			lines.push('<tasks>');
			for (const task of args.tasks) {
				const worker = task.sessionId
					? ` worker-session-id="${task.sessionId}"`
					: '';
				lines.push(
					`<task id="${task.id}" status="${task.status}" position="${task.position}"${worker}>${task.content}${task.note ? ` <note>${task.note}</note>` : ''}</task>`,
				);
			}
			lines.push('</tasks>');
		} else {
			lines.push('<tasks />');
		}
		lines.push('</goal>');
	} else {
		lines.push('<goal />');
	}

	const transcript = await buildRecentTranscript(
		args.db,
		args.workerSession.id,
	);
	if (transcript.length) {
		lines.push(
			'<transcript note="oldest first; [auto] = automated message, including your own previous [looper] continuations">',
			...transcript,
			'</transcript>',
		);
	}

	const allSubagents = await args.db
		.select()
		.from(subagents)
		.where(eq(subagents.parentSessionId, args.workerSession.id));
	const running = allSubagents.filter((record) => record.status === 'running');
	const delivered = allSubagents.filter(
		(record) => record.status !== 'running' && record.reported,
	);
	const undelivered = allSubagents.filter(
		(record) => record.status !== 'running' && !record.reported,
	);
	if (running.length || delivered.length || undelivered.length) {
		lines.push('<subagents>');
		for (const record of running) {
			lines.push(
				`<subagent agent="${record.agent}" status="running" note="Do not dispatch duplicate work for tasks it covers." />`,
			);
		}
		for (const record of delivered) {
			lines.push(
				`<subagent agent="${record.agent}" status="${record.status}" delivered="true" note="Result already delivered to the worker agent; do not mention or re-send it." />`,
			);
		}
		for (const record of undelivered) {
			lines.push(
				`<subagent agent="${record.agent}" status="${record.status}" delivered="false" note="Delivered automatically on next idle; do NOT copy it into your continuation." />`,
			);
		}
		lines.push('</subagents>');
	}

	lines.push(
		'<instructions>',
		'A worker session run finished. Check up on it.',
		'Follow your instructions: verify finished work, update task statuses, and dispatch or enqueue a continuation only if work remains or the error needs a retry.',
		'If a previous [looper] message of yours was already answered in the conversation above, act on that answer (complete or keep tasks with a note) — never re-ask the same thing.',
		'Sub-agent results are delivered to the dispatching session automatically — never repeat, summarize, or re-send them. Keep any enqueued continuation to one short line: which task to do next.',
		'</instructions>',
		'</looper_wakeup>',
	);
	return lines.join('\n');
}
