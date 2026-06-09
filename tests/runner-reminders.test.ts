import { describe, expect, test } from 'bun:test';
import {
	appendRunnerReminderMessages,
	type RunnerMessage,
} from '../packages/server/src/runtime/agent/runner-reminders.ts';

function user(content: string): RunnerMessage {
	return { role: 'user', content };
}

function assistant(content: string): RunnerMessage {
	return { role: 'assistant', content };
}

describe('runner reminders', () => {
	test('keeps the latest user request as the final message in existing sessions', () => {
		const messages = [
			user('first request'),
			assistant('first answer'),
			user('follow-up request'),
		];

		appendRunnerReminderMessages({
			messages,
			isFirstMessage: false,
			isOpenAIOAuth: false,
		});

		expect(messages.at(-1)?.content).toBe('follow-up request');
		expect(String(messages.at(-2)?.content)).toContain(
			'Continuing an existing session',
		);
	});

	test('appends continuation reminders when there is no trailing user request', () => {
		const messages = [user('request'), assistant('partial answer')];

		appendRunnerReminderMessages({
			messages,
			isFirstMessage: false,
			isOpenAIOAuth: false,
			continuationCount: 1,
		});

		expect(String(messages.at(-1)?.content)).toContain(
			'Your previous response stopped before calling `finish`',
		);
	});

	test('uses OpenAI OAuth-safe reminder text without making it the final user request', () => {
		const messages = [
			user('first request'),
			assistant('done'),
			user('next task'),
		];

		appendRunnerReminderMessages({
			messages,
			isFirstMessage: false,
			isOpenAIOAuth: true,
		});

		expect(messages.at(-1)?.content).toBe('next task');
		expect(String(messages.at(-2)?.content)).toContain('[system-reminder]');
		expect(String(messages.at(-2)?.content)).not.toContain('<system-reminder>');
	});
});
