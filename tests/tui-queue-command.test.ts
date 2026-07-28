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
		sendQueuedNow: async () => true,
		updateDefaults: async () => {},
		reload: () => {},
		...overrides,
	};
	return { ctx, statuses };
}

describe('TUI queued-message command', () => {
	test('only suggests /send when a message is queued', () => {
		expect(
			getCommandSuggestions('', false).some(
				(command) => command.name === 'send',
			),
		).toBe(false);
		expect(
			getCommandSuggestions('', true).some(
				(command) => command.name === 'send',
			),
		).toBe(true);
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

		expect(getCommandSuggestions('publish', false, recipes)).toEqual([
			{
				name: 'publish-ready',
				alias: '',
				description: 'Prepare a release (project)',
			},
		]);
		expect(getCommandSuggestions('daily', false, recipes)[0]?.description).toBe(
			'global recipe',
		);
		expect(getCommandSuggestions('blocked', false, recipes)).toEqual([]);
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

	test('sends the first queued message by default', async () => {
		let position: number | undefined;
		const { ctx, statuses } = commandContext({
			sendQueuedNow: async (nextPosition) => {
				position = nextPosition;
				return true;
			},
		});

		await executeCommand('send', '', ctx);

		expect(position).toBe(1);
		expect(statuses.at(-1)).toEqual({
			type: 'success',
			label: 'sent queued message 1',
		});
	});

	test('accepts a one-based queue position', async () => {
		let position: number | undefined;
		const { ctx } = commandContext({
			sendQueuedNow: async (nextPosition) => {
				position = nextPosition;
				return true;
			},
		});

		await executeCommand('send', '3', ctx);
		expect(position).toBe(3);
	});

	test('rejects invalid queue positions without dispatching', async () => {
		let called = false;
		const { ctx, statuses } = commandContext({
			sendQueuedNow: async () => {
				called = true;
				return true;
			},
		});

		await executeCommand('send', '0', ctx);
		expect(called).toBe(false);
		expect(statuses.at(-1)).toEqual({
			type: 'error',
			label: 'usage: /send [queue position]',
		});
	});
});
