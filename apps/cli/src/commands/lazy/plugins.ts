import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerPluginsCommand(program: Command) {
	const plugins = program.command('plugins').description('Manage Otto plugins');

	plugins
		.command('list', { isDefault: true })
		.description('List installed plugins')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--json', 'Output as JSON', false)
		.action(async (opts) => {
			const argv = ['plugins', 'list'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--json', opts.json);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	plugins
		.command('search [query]')
		.description('Search the plugin registry')
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (query, opts) => {
			const argv = ['plugins', 'search'];
			if (query) argv.push(query);
			pushOption(argv, '--registry', opts.registry);
			pushFlag(argv, '--json', opts.json);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	plugins
		.command('info <name>')
		.description('Show registry plugin details')
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (name, opts) => {
			const argv = ['plugins', 'info', name];
			pushOption(argv, '--registry', opts.registry);
			pushFlag(argv, '--json', opts.json);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	plugins
		.command('install <source>')
		.description('Install a plugin from the registry or a local directory')
		.option('--scope <scope>', 'Install scope: global or project', 'global')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--registry <url>', 'Registry URL')
		.option('--json', 'Output as JSON', false)
		.action(async (source, opts) => {
			const argv = ['plugins', 'install', source];
			pushOption(argv, '--scope', opts.scope);
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--registry', opts.registry);
			pushFlag(argv, '--json', opts.json);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
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
				const argv = ['plugins', commandName, name];
				pushOption(argv, '--scope', opts.scope);
				pushOption(argv, '--project', opts.project);
				const { registerPluginsCommand: register } = await import(
					'../plugins.ts'
				);
				await dispatchRegisteredCommand(register, argv);
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
			const argv = ['plugins', 'update', name];
			pushOption(argv, '--scope', opts.scope);
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--registry', opts.registry);
			pushFlag(argv, '--json', opts.json);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	plugins
		.command('validate [path]')
		.description('Validate a local native plugin manifest and tool entries')
		.option('--json', 'Output as JSON', false)
		.action(async (path, opts) => {
			const argv = ['plugins', 'validate'];
			if (path) argv.push(path);
			pushFlag(argv, '--json', opts.json);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	plugins
		.command('dev <path> <tool>')
		.description('Run a local native plugin tool with JSON input')
		.option('--project <path>', 'Project root for the tool', process.cwd())
		.option('--input <json>', 'Inline JSON input', '{}')
		.option('--input-file <path>', 'Read JSON input from a file')
		.action(async (path, tool, opts) => {
			const argv = ['plugins', 'dev', path, tool];
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--input', opts.input);
			pushOption(argv, '--input-file', opts.inputFile);
			const { registerPluginsCommand: register } = await import(
				'../plugins.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}
