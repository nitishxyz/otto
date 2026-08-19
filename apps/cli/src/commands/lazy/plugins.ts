import type { Command } from 'commander';
import type { PluginScope } from '@ottocode/sdk';

function normalizeOptions<T extends { scope?: string }>(
	opts: T,
): T & { scope: PluginScope } {
	if (opts.scope && opts.scope !== 'global' && opts.scope !== 'project') {
		throw new Error(`Invalid plugin scope: ${opts.scope}`);
	}
	return { ...opts, scope: (opts.scope ?? 'global') as PluginScope };
}

export function registerPluginsCommand(program: Command) {
	const plugins = program.command('plugins').description('Manage Otto plugins');

	plugins
		.command('list', { isDefault: true })
		.description('List installed plugins')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--json', 'Output as JSON', false)
		.action(async (opts) => {
			const { runPluginsList } = await import('../../plugins.ts');
			await runPluginsList(opts);
		});

	plugins
		.command('search [query]')
		.description('Search the plugin registry')
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (query, opts) => {
			const { runPluginsSearch } = await import('../../plugins.ts');
			await runPluginsSearch(query, { ...opts, project: process.cwd() });
		});

	plugins
		.command('info <name>')
		.description('Show registry plugin details')
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (name, opts) => {
			const { runPluginsInfo } = await import('../../plugins.ts');
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
			const { runPluginsInstall } = await import('../../plugins.ts');
			await runPluginsInstall(source, normalizeOptions(opts));
		});

	for (const commandName of ['remove', 'enable', 'disable'] as const) {
		plugins
			.command(`${commandName} <name>`)
			.description(
				`${commandName[0]?.toUpperCase()}${commandName.slice(1)} a plugin`,
			)
			.option('--scope <scope>', 'Scope: global or project', 'global')
			.option('--project <path>', 'Use project at <path>', process.cwd())
			.action(async (name, opts) => {
				const handlers = await import('../../plugins.ts');
				if (commandName === 'remove') {
					await handlers.runPluginsRemove(name, normalizeOptions(opts));
				} else {
					await handlers.runPluginsSetEnabled(
						name,
						commandName === 'enable',
						normalizeOptions(opts),
					);
				}
			});
	}

	plugins
		.command('update <name>')
		.description('Update an installed plugin')
		.option('--scope <scope>', 'Scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (name, opts) => {
			const { runPluginsUpdate } = await import('../../plugins.ts');
			await runPluginsUpdate(name, normalizeOptions(opts));
		});

	plugins
		.command('validate [path]')
		.description('Validate a local native plugin manifest and tool entries')
		.option('--json', 'Output as JSON', false)
		.action(async (path, opts) => {
			const { runPluginsValidate } = await import('../../plugins.ts');
			await runPluginsValidate(path ?? process.cwd(), opts);
		});

	plugins
		.command('dev <path> <tool>')
		.description('Run a local native plugin tool with JSON input')
		.option('--project <path>', 'Project root for the tool', process.cwd())
		.option('--input <json>', 'Inline JSON input', '{}')
		.option('--input-file <path>', 'Read JSON input from a file')
		.action(async (path, tool, opts) => {
			const { runPluginsDev } = await import('../../plugins.ts');
			await runPluginsDev(path, tool, opts);
		});
}
