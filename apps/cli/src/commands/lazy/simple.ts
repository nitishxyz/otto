import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerModelsCommand(program: Command) {
	program
		.command('models')
		.alias('switch')
		.description('Pick default provider/model (interactive)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--local', 'Store selection locally', false)
		.action(async (opts) => {
			const argv = ['models'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--local', opts.local);
			const { registerModelsCommand: register } = await import('../models.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}

export function registerAgentsCommand(program: Command) {
	program
		.command('agents')
		.description('Edit agents.json entries (interactive)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--local', 'Edit local project agents', false)
		.action(async (opts) => {
			const argv = ['agents'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--local', opts.local);
			const { registerAgentsCommand: register } = await import('../agents.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}

export function registerToolsCommand(program: Command) {
	program
		.command('tools')
		.description('List discovered tools and agent access')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const argv = ['tools'];
			pushOption(argv, '--project', opts.project);
			const { registerToolsCommand: register } = await import('../tools.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}

export function registerScaffoldCommand(program: Command) {
	program
		.command('scaffold')
		.alias('generate')
		.description('Create agents, tools, or commands (interactive)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--local', 'Create in local project directory', false)
		.action(async (opts) => {
			const argv = ['scaffold'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--local', opts.local);
			const { registerScaffoldCommand: register } = await import(
				'../scaffold.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}

export function registerDoctorCommand(program: Command) {
	program
		.command('doctor')
		.description('Diagnose auth, defaults, and agent/tool issues')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const argv = ['doctor'];
			pushOption(argv, '--project', opts.project);
			const { registerDoctorCommand: register } = await import('../doctor.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}
