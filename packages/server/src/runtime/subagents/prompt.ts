export function buildSubagentPrompt(args: {
	parentSessionId: string;
	parentAgent: string;
	task: string;
	context?: string;
	isReuse?: boolean;
}): string {
	const lines = [
		args.isReuse
			? 'You are running as a delegated sub-agent, continuing in a session you used for earlier related work. Your prior context (files explored, changes made) still applies — build on it instead of re-discovering.'
			: 'You are running as a delegated sub-agent.',
		'',
		`Parent session: ${args.parentSessionId}`,
		`Delegated by agent: ${args.parentAgent}`,
		'',
		args.isReuse ? 'New task:' : 'Task:',
		args.task,
	];
	if (args.context?.trim()) {
		lines.push(
			'',
			'Additional context from the delegating agent:',
			args.context,
		);
	}
	lines.push(
		'',
		'Complete the task, then END your final message with a structured result report. This report is the only thing the delegating agent sees — it is used to verify and accept your work, so make it factual and complete:',
		'',
		'## Result',
		'- Outcome: what was accomplished (or why it failed / was partially done)',
		'- Files changed: exact paths created/modified/deleted (or "none")',
		'- Verification: what you ran to check the work (commands, tests, lint) and their results (or "none")',
		'- Open issues: anything unresolved, follow-ups needed, or assumptions made (or "none")',
		'',
		'Never claim verification you did not perform. Do not ask the user follow-up questions.',
	);
	return lines.join('\n');
}

export function buildFollowUpPrompt(message: string): string {
	return [
		'Follow-up from the delegating agent:',
		'',
		message,
		'',
		'You still have your prior context. Complete this follow-up and END with the same structured "## Result" report (Outcome, Files changed, Verification, Open issues). Never claim verification you did not perform.',
	].join('\n');
}

export function buildSubagentResultsPrompt(
	finished: Array<{
		id: string;
		agent: string;
		status: string;
		task: string;
		summary: string | null;
	}>,
): string {
	const sections = finished.map((record) => {
		const attrs = `id="${record.id}" agent="${record.agent}" status="${record.status}"`;
		return [
			`<subagent_result ${attrs}>`,
			`<task>${record.task}</task>`,
			'<result>',
			record.summary ?? '(no summary)',
			'</result>',
			'</subagent_result>',
		].join('\n');
	});
	return [
		'<subagent_results>',
		sections.join('\n\n'),
		'</subagent_results>',
		'',
		"The delegated work is complete and the report above is the source of truth. Accept the child's ownership and verification: do not inspect its files, check Git, or rerun commands merely to verify it again. Update any parent task state and respond to the user with the outcome. If the report identifies a concrete unresolved issue inside the delegated scope, send a focused follow-up to the same child (or delegate another child) rather than silently taking over. Handle work yourself only when it is outside the delegated scope.",
	].join('\n');
}

export function buildSubagentCompactionCompletePrompt(args: {
	subagentId: string;
	agent: string;
	childSessionId: string;
}): string {
	return [
		`<subagent_compaction subagent_id="${args.subagentId}" agent="${args.agent}" child_session_id="${args.childSessionId}" status="completed">`,
		'The sub-agent context was compacted successfully.',
		'</subagent_compaction>',
		'',
		'Compaction is complete. Continue with the pending parent work now. The child session remains available for related follow-up messages.',
	].join('\n');
}
