import type { Command } from 'commander';
import {
	runPluginsInfo,
	runPluginsInstall,
	runPluginsList,
	runPluginsRemove,
	runPluginsSearch,
	runPluginsSetEnabled,
	runPluginsSync,
	runPluginsUpdate,
	type PluginCommandOptions,
} from '../plugins.ts';
import type { PluginScope } from '@ottocode/sdk';

function normalizeOptions(opts: PluginCommandOptions): PluginCommandOptions {
	return {
		...opts,
		scope: parseScope(opts.scope),
	};
}

function parseScope(scope: string | undefined): PluginScope {
	if (!scope || scope === 'global') return 'global';
	if (scope === 'project') return 'project';
	throw new Error(`Invalid plugin scope: ${scope}`);
}

export function registerPluginsCommand(program: Command) {
	const plugins = program.command('plugins').description('Manage Otto plugins');

	plugins
		.command('list', { isDefault: true })
		.description('List installed plugins')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--json', 'Output as JSON', false)
		.action(async (opts) => {
			await runPluginsList(opts);
		});

	plugins
		.command('search [query]')
		.description('Search the plugin registry')
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (query, opts) => {
			await runPluginsSearch(query, { ...opts, project: process.cwd() });
		});

	plugins
		.command('info <name>')
		.description('Show registry plugin details')
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (name, opts) => {
			await runPluginsInfo(name, { ...opts, project: process.cwd() });
		});

	plugins
		.command('install <source>')
		.description('Install a plugin from the registry or a local directory')
		.option('--scope <scope>', 'Install scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (source, opts) => {
			await runPluginsInstall(source, normalizeOptions(opts));
		});

	plugins
		.command('remove <name>')
		.description('Remove an installed plugin')
		.option('--scope <scope>', 'Scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			await runPluginsRemove(name, normalizeOptions(opts));
		});

	plugins
		.command('enable <name>')
		.description('Enable a plugin')
		.option('--scope <scope>', 'Scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			await runPluginsSetEnabled(name, true, normalizeOptions(opts));
		});

	plugins
		.command('disable <name>')
		.description('Disable a plugin')
		.option('--scope <scope>', 'Scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			await runPluginsSetEnabled(name, false, normalizeOptions(opts));
		});

	plugins
		.command('update <name>')
		.description('Update an installed plugin')
		.option('--scope <scope>', 'Scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (name, opts) => {
			await runPluginsUpdate(name, normalizeOptions(opts));
		});

	plugins
		.command('sync')
		.description(
			'Re-sync plugin skills into .agents/skills and remove orphaned entries',
		)
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			await runPluginsSync({ ...opts, scope: undefined });
		});
}
