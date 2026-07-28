import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import React, { act } from 'react';
import { ChatView } from '../apps/tui/src/components/ChatView.tsx';
import { MessageItem } from '../apps/tui/src/components/MessageItem.tsx';
import { ThemeProvider } from '../apps/tui/src/theme/context.tsx';
import type { Message } from '../apps/tui/src/types.ts';

function makeUserMessage(content: string): Message {
	return {
		id: 'queued-user',
		sessionId: 'session-1',
		role: 'user',
		status: 'complete',
		agent: '',
		provider: '',
		model: '',
		createdAt: 0,
		completedAt: 0,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [
			{
				id: 'queued-user-text',
				messageId: 'queued-user',
				index: 0,
				stepIndex: null,
				type: 'text',
				content: JSON.stringify({ text: content }),
				contentJson: { text: content },
				agent: '',
				provider: '',
				model: '',
				startedAt: 0,
				completedAt: 0,
				toolName: null,
				toolCallId: null,
				toolDurationMs: null,
			},
		],
	};
}

function makeAssistantMessage(
	id: string,
	content: string,
	createdAt: number,
): Message {
	return {
		id,
		sessionId: 'session-1',
		role: 'assistant',
		status: 'complete',
		agent: 'build-agent',
		provider: 'provider',
		model: 'model-name',
		createdAt,
		completedAt: createdAt,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [
			{
				id: `${id}-text`,
				messageId: id,
				index: 0,
				stepIndex: null,
				type: 'text',
				content: JSON.stringify({ text: content }),
				contentJson: { text: content },
				agent: 'build-agent',
				provider: 'provider',
				model: 'model-name',
				startedAt: createdAt,
				completedAt: createdAt,
				toolName: null,
				toolCallId: null,
				toolDurationMs: null,
			},
		],
	};
}

describe('TUI queued message rendering', () => {
	test('shows one header for consecutive assistant messages', async () => {
		const setup = await testRender(
			React.createElement(
				ThemeProvider,
				null,
				React.createElement(ChatView, {
					messages: [
						makeAssistantMessage('assistant-1', 'First response.', 1),
						makeAssistantMessage('assistant-2', 'Continued response.', 2),
					],
					isStreaming: false,
					streamingMessageId: null,
					queuedMessageIds: new Set<string>(),
					pendingApprovals: [],
					onApprove: () => {},
					onDeny: () => {},
				}),
			),
			{ width: 72, height: 16 },
		);

		try {
			await setup.renderOnce();
			const frame = setup.captureCharFrame();
			expect(frame.match(/build-agent/g)).toHaveLength(1);
			expect(frame.match(/provider\/model-name/g)).toHaveLength(1);
			expect(frame).toContain('First response.');
			expect(frame).toContain('Continued response.');
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	test('lays out every line after a queued message is promoted', async () => {
		const message = makeUserMessage(
			'This promoted queued message must wrap across multiple lines correctly.',
		);
		let promote: (() => void) | null = null;

		function Probe() {
			const [isQueued, setIsQueued] = React.useState(true);
			promote = () => setIsQueued(false);
			return React.createElement(MessageItem, {
				message,
				isStreaming: false,
				isQueued,
				isFirstMessage: true,
			});
		}

		const setup = await testRender(
			React.createElement(ThemeProvider, null, React.createElement(Probe)),
			{ width: 48, height: 12 },
		);

		try {
			await setup.renderOnce();
			expect(setup.captureCharFrame()).toContain('○ queued');

			await act(async () => {
				promote?.();
			});
			await setup.renderOnce();

			const promotedFrame = setup.captureCharFrame();
			expect(promotedFrame).not.toContain('○ queued');
			expect(promotedFrame).toContain('must wrap');
			expect(promotedFrame).toContain('across multiple lines correctly.');
			expect(
				promotedFrame.split('\n').some((line) => line.startsWith('▍')),
			).toBe(true);
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});
});
