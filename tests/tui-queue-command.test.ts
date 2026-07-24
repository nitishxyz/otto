import { describe, expect, test } from 'bun:test';
import {
	executeCommand,
	type CommandContext,
} from '../apps/tui/src/commands/dispatcher.ts';
import { COMMANDS } from '../apps/tui/src/commands/registry.ts';
import type { StatusIndicator } from '../apps/tui/src/stores/overlay.ts';

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
	test('registers /send in slash command suggestions', () => {
		expect(COMMANDS.some((command) => command.name === 'send')).toBe(true);
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
