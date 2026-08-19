import { describe, expect, test } from 'bun:test';
import { consumeDictationWebSocketTicket } from '../packages/server/src/routes/dictation/ws-ticket.ts';
import {
	clearTerminalWebSocketTickets,
	consumeTerminalWebSocketTicket,
	createTerminalWebSocketTicket,
} from '../packages/server/src/routes/terminals/ws-ticket.ts';
import { OneTimeWebSocketTicketStore } from '../packages/server/src/runtime/websocket-ticket-store.ts';

describe('one-time WebSocket ticket store', () => {
	test('expires tickets using the injected clock and supports explicit cleanup', () => {
		let now = 1_000;
		const store = new OneTimeWebSocketTicketStore({
			ttlMs: 50,
			now: () => now,
			createToken: () => 'expiring-ticket',
		});
		const { ticket, expiresIn } = store.mint({
			audience: 'terminal',
			subject: 'term-1',
		});
		expect(expiresIn).toBe(0.05);
		expect(store.size).toBe(1);

		now = 1_050;
		store.cleanupExpired();
		expect(store.size).toBe(0);
		expect(
			store.consume({
				ticket,
				audience: 'terminal',
				subject: 'term-1',
			}),
		).toBeUndefined();
	});

	test('binds audience and subject without consuming on a binding mismatch', () => {
		const store = new OneTimeWebSocketTicketStore({
			createToken: () => 'bound-ticket',
		});
		const { ticket } = store.mint({
			audience: 'terminal',
			subject: 'term-1',
			projectId: 'project-1',
		});

		expect(
			store.consume({ ticket, audience: 'dictation', subject: 'term-1' }),
		).toBeUndefined();
		expect(
			store.consume({ ticket, audience: 'terminal', subject: 'term-2' }),
		).toBeUndefined();
		expect(
			store.consume({ ticket, audience: 'terminal', subject: 'term-1' }),
		).toEqual({ projectId: 'project-1' });
		expect(
			store.consume({ ticket, audience: 'terminal', subject: 'term-1' }),
		).toBeUndefined();
	});

	test('consumes a share-bound ticket atomically before share validation', () => {
		const store = new OneTimeWebSocketTicketStore({
			createToken: () => 'share-ticket',
		});
		const { ticket } = store.mint({
			audience: 'dictation',
			subject: 'session-1',
			projectId: 'project-share',
			shareId: 'share-1',
		});
		const seen: unknown[] = [];

		expect(
			store.consume({
				ticket,
				audience: 'dictation',
				subject: 'session-1',
				isShareActive: (binding) => {
					seen.push(binding);
					return false;
				},
			}),
		).toBeUndefined();
		expect(seen).toEqual([{ shareId: 'share-1', projectId: 'project-share' }]);
		expect(
			store.consume({
				ticket,
				audience: 'dictation',
				subject: 'session-1',
				isShareActive: () => true,
			}),
		).toBeUndefined();
	});

	test('terminal tickets cannot authorize the dictation audience', () => {
		const { ticket } = createTerminalWebSocketTicket({
			terminalId: 'shared-subject',
			projectId: 'project-owner',
		});
		try {
			expect(
				consumeDictationWebSocketTicket(ticket, 'shared-subject'),
			).toBeUndefined();
			expect(consumeTerminalWebSocketTicket(ticket, 'shared-subject')).toEqual({
				projectId: 'project-owner',
			});
		} finally {
			clearTerminalWebSocketTickets();
		}
	});
});
