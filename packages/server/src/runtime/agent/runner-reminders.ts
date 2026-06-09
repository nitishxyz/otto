export type RunnerMessage = {
	role: string;
	content: string | Array<unknown>;
};

function insertReminderBeforeTrailingUserMessage(
	messages: RunnerMessage[],
	reminder: RunnerMessage,
): void {
	const lastMessage = messages.at(-1);
	const lastText =
		typeof lastMessage?.content === 'string' ? lastMessage.content : '';
	const lastIsReminder =
		lastText.startsWith('[system-reminder]') ||
		lastText.startsWith('<system-reminder>');
	if (lastMessage?.role === 'user' && !lastIsReminder) {
		messages.splice(messages.length - 1, 0, reminder);
		return;
	}

	messages.push(reminder);
}

export function appendRunnerReminderMessages(args: {
	messages: RunnerMessage[];
	isFirstMessage: boolean;
	isOpenAIOAuth: boolean;
	continuationCount?: number;
}): void {
	const { messages, isFirstMessage, isOpenAIOAuth, continuationCount } = args;

	if (!isFirstMessage) {
		insertReminderBeforeTrailingUserMessage(
			messages,
			isOpenAIOAuth
				? {
						role: 'user',
						content:
							'[system-reminder] Continuing an existing session. Execute directly, use tools as needed, and call `finish` at the end. For simple questions, your answer IS the response — do not add a "Summary:" recap.',
					}
				: {
						role: 'user',
						content:
							'<system-reminder>Continuing an existing session. Answer or complete the work directly, then call `finish`. For simple questions, your answer IS the response — do NOT add a labeled "Summary:" line or recap trivial replies.</system-reminder>',
					},
		);
	}

	if ((continuationCount ?? 0) <= 0) return;

	insertReminderBeforeTrailingUserMessage(
		messages,
		isOpenAIOAuth
			? {
					role: 'user',
					content:
						'[system-reminder] Your previous response stopped mid-task. Resume from where you left off and complete the actual work — not a plan-only update.',
				}
			: {
					role: 'user',
					content:
						'<system-reminder>Your previous response stopped before calling `finish`. Resume from where you left off, do the actual work (no plan-only updates), then stream a summary and call `finish`.</system-reminder>',
				},
	);
}
