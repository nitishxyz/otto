import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerProjectsCommand } from '../apps/cli/src/commands/lazy/projects.ts';
import { registerAuthCommand } from '../apps/cli/src/commands/lazy/auth.ts';
import { registerDebugCommand } from '../apps/cli/src/commands/lazy/debug.ts';
import { registerMCPCommand } from '../apps/cli/src/commands/lazy/mcp.ts';
import { registerPluginsCommand } from '../apps/cli/src/commands/lazy/plugins.ts';
import { registerProvidersCommand } from '../apps/cli/src/commands/lazy/providers.ts';
import { registerServiceCommand } from '../apps/cli/src/commands/lazy/service.ts';
import {
	registerServeCommand,
	toServeOptions,
} from '../apps/cli/src/commands/lazy/serve.ts';
import { registerTunnelCommand } from '../apps/cli/src/commands/lazy/tunnel.ts';
import {
	registerAgentsCommand,
	registerDoctorCommand,
	registerModelsCommand,
	registerScaffoldCommand,
	registerToolsCommand,
} from '../apps/cli/src/commands/lazy/simple.ts';
import {
	registerWebCommand,
	toWebOptions,
} from '../apps/cli/src/commands/lazy/web.ts';
import {
	parseCliPort,
	parseOptionalCliPort,
} from '../apps/cli/src/runtime/network.ts';

function command(program: Command, name: string): Command {
	const found = program.commands.find((item) => item.name() === name);
	if (!found) throw new Error(`Missing command: ${name}`);
	return found;
}

describe('CLI lazy command contracts', () => {
	it('keeps remaining command names, aliases, defaults, and subcommands stable', () => {
		const program = new Command().name('otto');
		registerAuthCommand(program);
		registerDebugCommand(program);
		registerMCPCommand(program);
		registerPluginsCommand(program);
		registerProvidersCommand(program);
		registerModelsCommand(program);
		registerAgentsCommand(program);
		registerToolsCommand(program);
		registerScaffoldCommand(program);
		registerDoctorCommand(program);

		expect(
			command(program, 'auth').commands.map((item) => item.name()),
		).toEqual(['login', 'status', 'list', 'logout']);
		expect(command(command(program, 'auth'), 'list').aliases()).toEqual(['ls']);
		expect(command(program, 'mcp').commands.map((item) => item.name())).toEqual(
			['list', 'status', 'test', 'add', 'remove', 'auth'],
		);
		expect(command(program, 'providers').aliases()).toEqual(['provider']);
		expect(command(program, 'models').aliases()).toEqual(['switch']);
		expect(command(program, 'scaffold').aliases()).toEqual(['generate']);
		expect(
			command(program, 'plugins').commands.map((item) => item.name()),
		).toEqual([
			'list',
			'search',
			'info',
			'install',
			'remove',
			'enable',
			'disable',
			'update',
			'validate',
			'dev',
		]);
	});

	it('removes the obsolete argv reconstruction helper', async () => {
		expect(
			await Bun.file(
				new URL('../apps/cli/src/commands/lazy/helpers.ts', import.meta.url),
			).exists(),
		).toBe(false);
	});

	it('registers priority command metadata once at the top level', () => {
		const program = new Command().name('otto');
		registerServeCommand(program, 'test');
		registerWebCommand(program, 'test');
		registerServiceCommand(program, 'test');
		registerProjectsCommand(program, 'test');
		registerTunnelCommand(program, 'test');

		expect(command(program, 'serve').description()).toBe(
			'Advanced: run a standalone foreground API/Web server',
		);
		expect(command(program, 'web').helpInformation()).toContain('--no-open');
		expect(command(program, 'web').helpInformation()).not.toContain(
			'--api <url>',
		);
		expect(
			command(program, 'projects').commands.map((item) => item.name()),
		).toEqual(['list', 'open', 'close', 'forget']);
		expect(
			command(program, 'tunnel').commands.map((item) => item.name()),
		).toEqual(['enable', 'status', 'disable']);
	});

	it('keeps service force-start reachable with the normal service syntax', () => {
		const program = new Command().name('otto');
		registerServiceCommand(program, 'test');
		const service = command(program, 'service');
		const forceStart = command(service, 'force-start');

		expect(forceStart.description()).toBe(
			'Start a new daemon without reusing an existing registration',
		);
		expect(forceStart.helpInformation()).toContain('--project <path>');
		expect(forceStart.helpInformation()).toContain('--port <port>');
	});

	it('rejects invalid daemon ports before dispatching an action', async () => {
		for (const value of ['-1', '65536', '12abc', '', '0']) {
			const program = new Command().name('otto').exitOverride();
			program.configureOutput({ writeErr: () => {} });
			registerServiceCommand(program, 'test');
			await expect(
				program.parseAsync(['service', 'force-start', '--port', value], {
					from: 'user',
				}),
			).rejects.toThrow(`Invalid daemon port: ${value}`);
		}
	});

	it('forwards Commander boolean negations to typed handlers', () => {
		expect(
			toServeOptions({
				project: '/tmp/project',
				port: 4000,
				network: true,
				open: false,
				tunnel: true,
				apiOnly: false,
				daemonRegister: false,
			}),
		).toEqual({
			project: '/tmp/project',
			port: 4000,
			network: true,
			tunnel: true,
			noOpen: true,
			apiOnly: false,
			daemonRegister: false,
		});
		expect(
			toWebOptions({
				url: 'https://api.example.test',
				port: 0,
				network: false,
				open: false,
				project: '/tmp/project',
			}),
		).toMatchObject({ noOpen: true, port: 0 });
	});
});

describe('CLI port policy', () => {
	for (const value of ['-1', '65536', '12abc', '']) {
		it(`rejects ${JSON.stringify(value)} as a port`, () => {
			expect(() => parseCliPort(value, { allowZero: true })).toThrow(
				`Invalid port: ${value}`,
			);
		});
	}

	it('applies an explicit zero policy', () => {
		expect(parseCliPort('0', { allowZero: true })).toBe(0);
		expect(() =>
			parseCliPort('0', { allowZero: false, name: 'daemon port' }),
		).toThrow('Invalid daemon port: 0');
	});

	it('distinguishes an absent environment value from an empty one', () => {
		expect(
			parseOptionalCliPort(undefined, { allowZero: true }),
		).toBeUndefined();
		expect(() => parseOptionalCliPort('', { allowZero: true })).toThrow(
			'Invalid port:',
		);
	});
});
