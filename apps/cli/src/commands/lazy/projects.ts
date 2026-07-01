import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushOption } from './helpers.ts';

async function dispatch(argv: string[], version: string) {
	const { registerProjectsCommand } = await import('../projects.ts');
	await dispatchRegisteredCommand(
		(program) => registerProjectsCommand(program, version),
		argv,
	);
}

export function registerProjectsCommand(program: Command, version: string) {
	const projects = program
		.command('projects')
		.description('List, open, close, and forget daemon projects');

	projects
		.command('list')
		.description('List open and known projects')
		.option(
			'--project <path>',
			'Project used to start the daemon',
			process.cwd(),
		)
		.action(async (opts) => {
			const argv = ['projects', 'list'];
			pushOption(argv, '--project', opts.project);
			await dispatch(argv, version);
		});

	projects
		.command('open')
		.argument('<path>', 'Project path to open')
		.description('Open a project in the shared daemon')
		.action(async (projectPath: string) => {
			await dispatch(['projects', 'open', projectPath], version);
		});

	projects
		.command('close')
		.argument('<id>', 'Project id to close')
		.description('Close an open project runtime')
		.option(
			'--project <path>',
			'Project used to start the daemon',
			process.cwd(),
		)
		.action(async (projectId: string, opts) => {
			const argv = ['projects', 'close', projectId];
			pushOption(argv, '--project', opts.project);
			await dispatch(argv, version);
		});

	projects
		.command('forget')
		.argument('<id-or-path>', 'Project id or path to remove from registry')
		.description('Forget a known project without deleting its files')
		.option(
			'--project <path>',
			'Project used to start the daemon',
			process.cwd(),
		)
		.action(async (projectIdOrPath: string, opts) => {
			const argv = ['projects', 'forget', projectIdOrPath];
			pushOption(argv, '--project', opts.project);
			await dispatch(argv, version);
		});
}
