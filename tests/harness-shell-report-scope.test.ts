import { expect, spyOn, test } from 'bun:test';
import type { DB } from '@ottocode/database';
import type { OttoConfig } from '@ottocode/sdk';
import { reportFinishedShellJobs } from '../packages/server/src/runtime/shell-jobs/report.ts';
import {
	getOrCreateRunnerState,
	deleteRunnerState,
} from '../packages/server/src/runtime/session/queue/state.ts';
import {
	listShellJobsForSession,
	registerActiveShellProcess,
} from '../packages/server/src/runtime/tools/active-shells.ts';
import * as messages from '../packages/server/src/runtime/message/service.ts';

test('shell reporting scopes identical session IDs to their project queue and results', async () => {
	const sessionId = crypto.randomUUID();
	const roots = ['/tmp/shell-report-a', '/tmp/shell-report-b'];
	const states = roots.map((root) => getOrCreateRunnerState(sessionId, root));
	const jobs = roots.map((projectRoot) => {
		const job = registerActiveShellProcess({
			projectRoot,
			sessionId,
			messageId: crypto.randomUUID(),
			command: `echo ${projectRoot}`,
			cwd: projectRoot,
			abort: () => {},
			onDetach: () => {},
		});
		job.detach();
		job.complete({
			status: 'completed',
			result: { ok: true, stdout: projectRoot },
			exitCode: 0,
		});
		return job;
	});
	const delivered: Array<{ root: string; content: string }> = [];
	const dispatch = spyOn(
		messages,
		'dispatchAssistantMessage',
	).mockImplementation(async (input) => {
		delivered.push({ root: input.cfg.projectRoot, content: input.content });
		return {} as Awaited<ReturnType<typeof messages.dispatchAssistantMessage>>;
	});
	const database = (projectPath: string) =>
		({
			select: () => ({
				from: () => ({
					where: async () => [
						{
							id: sessionId,
							projectPath,
							agent: 'build',
							provider: 'openai',
							model: 'test',
						},
					],
				}),
			}),
		}) as unknown as DB;
	const config = (projectRoot: string) => ({ projectRoot }) as OttoConfig;
	try {
		states[1].running = true;
		expect(
			await reportFinishedShellJobs(
				database(roots[0]),
				config(roots[0]),
				sessionId,
			),
		).toBe(true);
		expect(delivered).toHaveLength(1);
		expect(delivered[0].root).toBe(roots[0]);
		expect(delivered[0].content).toContain(roots[0]);
		expect(delivered[0].content).not.toContain(roots[1]);
		expect(listShellJobsForSession(sessionId, roots[1])[0].reported).toBe(
			false,
		);
		expect(
			await reportFinishedShellJobs(
				database(roots[1]),
				config(roots[1]),
				sessionId,
			),
		).toBe(false);
		states[1].running = false;
		expect(
			await reportFinishedShellJobs(
				database(roots[1]),
				config(roots[1]),
				sessionId,
			),
		).toBe(true);
		expect(delivered).toHaveLength(2);
		expect(delivered[1].root).toBe(roots[1]);
		expect(delivered[1].content).toContain(roots[1]);
		expect(delivered[1].content).not.toContain(roots[0]);
	} finally {
		dispatch.mockRestore();
		for (const job of jobs) job.unregister();
		for (const root of roots) deleteRunnerState(sessionId, root);
	}
});
