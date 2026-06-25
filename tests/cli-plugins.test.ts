import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'bun:test';
import { loadPluginsConfig } from '@ottocode/sdk';
import { registerPluginsCommand } from '@ottocode/cli/src/commands/plugins.ts';

describe('cli plugins command', () => {
	it('installs, disables, enables, lists, and removes a project plugin', async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-cli-plugins-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(root, 'xdg-config');

		try {
			const payloadRoot = join(root, 'payloads');
			await writePluginPayload(payloadRoot, 'cli-plugin', '1.0.0');
			const registryPath = join(root, 'registry.json');
			await writeRegistry(
				registryPath,
				join(payloadRoot, 'cli-plugin'),
				'cli-plugin',
				'1.0.0',
			);

			await runPluginsCommand([
				'install',
				'cli-plugin',
				'--scope',
				'project',
				'--project',
				root,
				'--registry',
				registryPath,
			]);
			let config = await loadPluginsConfig('project', root);
			expect(config.plugins['cli-plugin']?.enabled).toBe(true);
			expect(config.plugins['cli-plugin']?.version).toBe('1.0.0');

			await runPluginsCommand([
				'disable',
				'cli-plugin',
				'--scope',
				'project',
				'--project',
				root,
			]);
			config = await loadPluginsConfig('project', root);
			expect(config.plugins['cli-plugin']?.enabled).toBe(false);

			await runPluginsCommand([
				'enable',
				'cli-plugin',
				'--scope',
				'project',
				'--project',
				root,
			]);
			config = await loadPluginsConfig('project', root);
			expect(config.plugins['cli-plugin']?.enabled).toBe(true);

			const output = await captureConsoleLog(() =>
				runPluginsCommand(['list', '--project', root, '--json']),
			);
			expect(JSON.parse(output)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'cli-plugin', scope: 'project' }),
				]),
			);

			await runPluginsCommand([
				'remove',
				'cli-plugin',
				'--scope',
				'project',
				'--project',
				root,
			]);
			config = await loadPluginsConfig('project', root);
			expect(config.plugins['cli-plugin']).toBeUndefined();
		} finally {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			await rm(root, { recursive: true, force: true });
		}
	});
});

async function runPluginsCommand(argv: string[]): Promise<void> {
	const program = new Command();
	program.exitOverride();
	registerPluginsCommand(program);
	await program.parseAsync(['plugins', ...argv], { from: 'user' });
}

async function captureConsoleLog(action: () => Promise<void>): Promise<string> {
	const originalLog = console.log;
	let output = '';
	console.log = (...args: unknown[]) => {
		output += `${args.join(' ')}\n`;
	};
	try {
		await action();
		return output;
	} finally {
		console.log = originalLog;
	}
}

async function writePluginPayload(
	pluginsDir: string,
	name: string,
	version: string,
): Promise<void> {
	const pluginDir = join(pluginsDir, name);
	await mkdir(pluginDir, { recursive: true });
	await writeFile(
		join(pluginDir, 'otto.plugin.json'),
		`${JSON.stringify({ name, version, description: `${name} plugin` }, null, 2)}\n`,
	);
}

async function writeRegistry(
	registryPath: string,
	payloadDir: string,
	name: string,
	version: string,
): Promise<void> {
	await writeFile(
		registryPath,
		`${JSON.stringify(
			{
				version: 1,
				plugins: [
					{
						name,
						version,
						description: `${name} plugin`,
						source: { type: 'local', path: payloadDir },
					},
				],
			},
			null,
			2,
		)}\n`,
	);
}
