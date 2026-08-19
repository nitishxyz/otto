import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import {
	formatMachineTunnelStatus,
	requiresOttoRouterLogin,
} from '../apps/cli/src/commands/tunnel.ts';
import { registerTunnelCommand } from '../apps/cli/src/commands/lazy/tunnel.ts';

describe('CLI tunnel command', () => {
	it('registers enable, status, and disable actions', () => {
		const program = new Command();
		registerTunnelCommand(program, '1.0.0');
		const tunnel = program.commands.find(
			(command) => command.name() === 'tunnel',
		);

		expect(tunnel?.commands.map((command) => command.name())).toEqual([
			'enable',
			'status',
			'disable',
		]);
	});

	it('formats connected machine tunnel details', () => {
		const output = formatMachineTunnelStatus({
			status: 'connected',
			url: 'https://machine.example.com',
			error: null,
			isRunning: true,
			hostname: 'machine.example.com',
			ottorouterConnected: true,
		});

		expect(output).toContain('Machine tunnel: connected');
		expect(output).toContain('running: yes');
		expect(output).toContain('OttoRouter: connected');
		expect(output).toContain('url: https://machine.example.com');
		expect(output).toContain('hostname: machine.example.com');
	});

	it('includes tunnel errors in status output', () => {
		const output = formatMachineTunnelStatus({
			status: 'error',
			url: null,
			error: 'cloudflared exited',
			isRunning: false,
			hostname: null,
			ottorouterConnected: false,
		});

		expect(output).toContain('OttoRouter: not connected');
		expect(output).toContain('error: cloudflared exited');
	});

	it('detects when tunnel enable should offer OttoRouter login', () => {
		expect(
			requiresOttoRouterLogin({
				ok: false,
				code: 'ottorouter_not_connected',
				error: 'Connect OttoRouter before starting a managed tunnel',
			}),
		).toBe(true);
		expect(
			requiresOttoRouterLogin({ ok: false, error: 'cloudflared exited' }),
		).toBe(false);
	});
});
