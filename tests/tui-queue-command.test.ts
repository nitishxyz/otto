import { describe, expect, test } from 'bun:test';
import {
	executeCommand,
	type CommandContext,
} from '../apps/tui/src/commands/dispatcher.ts';
import {
	getCommandSuggestions,
	isLocalTuiCommand,
	recipeSlashCommands,
} from '../apps/tui/src/commands/registry.ts';
import {
	getStreamingMessageIdAfterTerminalEvent,
	hasSameQueuedMessageOrder,
} from '../apps/tui/src/stream/client.ts';
import type { StatusIndicator } from '../apps/tui/src/stores/overlay.ts';
import { parseRecipeUserMessage } from '../apps/tui/src/components/MessageItem.tsx';
import { getQueuedMessageItems } from '../apps/tui/src/lib/queue.ts';
import type { Message, Overlay } from '../apps/tui/src/types.ts';

function commandContext(overrides: Partial<CommandContext> = {}): {
	ctx: CommandContext;
	statuses: StatusIndicator[];
} {
	const statuses: StatusIndicator[] = [];
	const ctx: CommandContext = {
		activeSession: null,
		reasoningText: true,
		onQuit: () => {},
		setOverlay: () => {},
		showStatus: (status) => statuses.push(status),
		loadSessions: async () => [],
		createSession: async () => null,
		deleteSession: async () => {},
		switchSession: () => {},
		updateSessionPrefs: async () => {},
		sendMessage: async () => {},
		abortSession: async () => {},
		updateDefaults: async () => {},
		reload: () => {},
		...overrides,
	};
	return { ctx, statuses };
}

describe('TUI queued-message command', () => {
	test('always suggests /queue and opens the queue overlay', async () => {
		let overlay: Overlay = 'none';
		expect(
			getCommandSuggestions('').some((command) => command.name === 'queue'),
		).toBe(true);

		const { ctx } = commandContext({
			setOverlay: (nextOverlay) => {
				overlay = nextOverlay;
			},
		});
		await executeCommand('queue', '', ctx);
		expect(overlay).toBe('queue');
	});

	test('suggests /sub-agents and opens the subagent overlay', async () => {
		let overlay: Overlay = 'none';
		expect(
			getCommandSuggestions('sub-').some(
				(command) => command.name === 'sub-agents',
			),
		).toBe(true);

		const { ctx } = commandContext({
			setOverlay: (nextOverlay) => {
				overlay = nextOverlay;
			},
		});
		await executeCommand('sub-agents', '', ctx);
		expect(overlay).toBe('subagents');
	});

	test('maps queued assistants to compact user-message summaries', () => {
		const messages = [
			{
				id: 'user-1',
				role: 'user',
				createdAt: 1,
				parts: [
					{
						id: 'part-1',
						index: 0,
						type: 'text',
						content: 'first\n message',
					},
				],
			},
			{ id: 'assistant-1', role: 'assistant', createdAt: 2 },
			{
				id: 'user-2',
				role: 'user',
				createdAt: 3,
				attachmentNames: ['one.png', 'two.txt'],
				parts: [
					{
						id: 'part-2',
						index: 0,
						type: 'text',
						content: 'second message',
					},
				],
			},
			{ id: 'assistant-2', role: 'assistant', createdAt: 4 },
		] as Message[];

		expect(
			getQueuedMessageItems(messages, new Set(['assistant-2', 'assistant-1'])),
		).toEqual([
			{
				assistantMessageId: 'assistant-2',
				userMessageId: 'user-2',
				summary: '◳ 2 attachments · second message',
			},
			{
				assistantMessageId: 'assistant-1',
				userMessageId: 'user-1',
				summary: 'first message',
			},
		]);
	});

	test('previews queued users before queued assistant records arrive', () => {
		const messages = [
			{
				id: 'active-user',
				role: 'user',
				createdAt: 1,
				parts: [
					{ id: 'active-part', index: 0, type: 'text', content: 'active' },
				],
			},
			{ id: 'active-assistant', role: 'assistant', createdAt: 2 },
			{
				id: 'queued-user-1',
				role: 'user',
				createdAt: 3,
				parts: [
					{ id: 'q1-part', index: 0, type: 'text', content: 'first queued' },
				],
			},
			{
				id: 'queued-user-2',
				role: 'user',
				createdAt: 4,
				parts: [
					{ id: 'q2-part', index: 0, type: 'text', content: 'second queued' },
				],
			},
		] as Message[];

		expect(
			getQueuedMessageItems(
				messages,
				new Set(['queued-assistant-1', 'queued-assistant-2']),
			).map((item) => item.summary),
		).toEqual(['first queued', 'second queued']);
	});

	test('suggests non-conflicting project and global recipes', () => {
		const recipes = recipeSlashCommands([
			{
				name: 'publish-ready',
				scope: 'project',
				description: 'Prepare a release',
			},
			{
				name: 'daily-review',
				scope: 'global',
				description: '',
			},
			{
				name: 'blocked',
				scope: 'project',
				description: 'Do not show',
				conflict: { reason: 'duplicate' },
			},
		]);

		expect(getCommandSuggestions('publish', recipes)).toEqual([
			{
				name: 'publish-ready',
				alias: '',
				description: 'Prepare a release (project)',
			},
		]);
		expect(getCommandSuggestions('daily', recipes)[0]?.description).toBe(
			'global recipe',
		);
		expect(getCommandSuggestions('blocked', recipes)).toEqual([]);
	});

	test('does not let recipes shadow TUI commands or duplicate scopes', () => {
		const recipes = recipeSlashCommands([
			{ name: 'mcp', scope: 'project', description: 'Shadow MCP' },
			{ name: 's', scope: 'project', description: 'Shadow sessions alias' },
			{ name: 'review', scope: 'project', description: 'Project review' },
			{ name: 'review', scope: 'global', description: 'Global review' },
		]);

		expect(recipes.map((command) => command.name)).toEqual(['review']);
	});

	test('sends recipes and runtime commands through the normal chat path', () => {
		expect(isLocalTuiCommand('publish-ready')).toBe(false);
		expect(isLocalTuiCommand('init')).toBe(false);
		expect(isLocalTuiCommand('compact')).toBe(false);
		expect(isLocalTuiCommand('mcp')).toBe(true);
		expect(isLocalTuiCommand('p')).toBe(true);
		expect(isLocalTuiCommand('provider')).toBe(true);
	});

	test('parses recipe user messages for color-coded rendering', () => {
		const recipes = new Set(['publish-ready']);
		expect(parseRecipeUserMessage('/publish-ready web tui', recipes)).toEqual({
			command: '/publish-ready',
			remainder: ' web tui',
		});
		expect(parseRecipeUserMessage('/unknown web tui', recipes)).toBeNull();
		expect(parseRecipeUserMessage('publish-ready web tui', recipes)).toBeNull();
	});

	test('forwards selected recipe commands and arguments to the server', async () => {
		const sent: string[] = [];
		const { ctx } = commandContext({
			activeSession: { id: 'session-1' } as CommandContext['activeSession'],
			sendMessage: async (_sessionId, content) => {
				sent.push(content);
			},
		});

		await executeCommand('publish-ready', 'web tui', ctx);
		expect(sent).toEqual(['/publish-ready web tui']);
	});

	test('creates a session before forwarding a recipe when none is active', async () => {
		const sent: Array<{ sessionId: string; content: string }> = [];
		let createCount = 0;
		const { ctx } = commandContext({
			createSession: async () => {
				createCount++;
				return { id: 'new-session' } as CommandContext['activeSession'];
			},
			sendMessage: async (sessionId, content) => {
				sent.push({ sessionId, content });
			},
		});

		await executeCommand('publish-ready', 'web tui', ctx);
		expect(createCount).toBe(1);
		expect(sent).toEqual([
			{ sessionId: 'new-session', content: '/publish-ready web tui' },
		]);
	});

	test('keeps a promoted message active when the preempted message completes', () => {
		expect(
			getStreamingMessageIdAfterTerminalEvent('promoted', { id: 'preempted' }),
		).toBe('promoted');
		expect(
			getStreamingMessageIdAfterTerminalEvent('promoted', { id: 'promoted' }),
		).toBeNull();
	});

	test('preserves queue position changes', () => {
		const current = new Set(['first', 'second']);
		expect(hasSameQueuedMessageOrder(current, ['first', 'second'])).toBe(true);
		expect(hasSameQueuedMessageOrder(current, ['second', 'first'])).toBe(false);
	});
});
