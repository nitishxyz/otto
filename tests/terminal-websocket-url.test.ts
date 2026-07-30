import { describe, expect, test } from 'bun:test';
import { getActiveTerminal } from '../packages/web-sdk/src/components/terminals/TerminalsPanel.tsx';
import { terminalWebSocketUrl } from '../packages/web-sdk/src/components/terminals/TerminalViewer.tsx';

describe('terminal WebSocket URL', () => {
	test('uses wss for HTTPS tunnels and includes only one-time ticket', () => {
		const url = new URL(
			terminalWebSocketUrl(
				'https://machine.ottorouter.org',
				'terminal/id',
				'one-time-ticket',
			),
		);
		expect(url.protocol).toBe('wss:');
		expect(url.pathname).toBe('/v1/terminals/terminal%2Fid/ws');
		expect(url.searchParams.get('ticket')).toBe('one-time-ticket');
		expect(url.searchParams.has('share')).toBe(false);
		expect(url.searchParams.has('token')).toBe(false);
	});

	test('uses ws for local HTTP daemon', () => {
		expect(
			new URL(
				terminalWebSocketUrl('http://127.0.0.1:47477', 'term-1', 'ticket'),
			).protocol,
		).toBe('ws:');
	});

	test('selects the active terminal in each window', () => {
		const terminals = [
			{ id: 'term-1', title: 'One' },
			{ id: 'term-2', title: 'Two' },
		];

		expect(getActiveTerminal(terminals, 'term-2')).toBe(terminals[1]);
		expect(getActiveTerminal(terminals, null)).toBeUndefined();
	});
});
