import type { Command } from 'commander';

export function registerModelsCommand(program: Command) {
	program
		.command('models')
		.alias('switch')
		.description('Pick default provider/model (interactive)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--local', 'Store selection locally', false)
		.action(async (opts) => {
			const { runModels } = await import('../../models.ts');
			await runModels({ project: opts.project, local: opts.local });
		});
}

export function registerAgentsCommand(program: Command) {
	program
		.command('agents')
		.description('Edit agents.json entries (interactive)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--local', 'Edit local project agents', false)
		.action(async (opts) => {
			const { runAgents } = await import('../../agents.ts');
			await runAgents({ project: opts.project, local: opts.local });
		});
}

export function registerToolsCommand(program: Command) {
	program
		.command('tools')
		.description('List discovered tools and agent access')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const { runToolsList } = await import('../../tools.ts');
			await runToolsList({ project: opts.project });
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
			const { runScaffold } = await import('../../scaffold.ts');
			await runScaffold({ project: opts.project, local: opts.local });
		});
}

export function registerDoctorCommand(program: Command) {
	program
		.command('doctor')
		.description('Diagnose auth, defaults, and agent/tool issues')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const { runDoctorCommand } = await import('../../doctor.ts');
			await runDoctorCommand({ project: opts.project });
		});
}
