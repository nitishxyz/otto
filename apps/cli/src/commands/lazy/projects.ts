import type { Command } from 'commander';
import type { ProjectsOptions } from '../projects.ts';

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
		.action(async (opts: ProjectsOptions) => {
			const { listProjects } = await import('../projects.ts');
			await listProjects(opts, version);
		});

	projects
		.command('open')
		.argument('<path>', 'Project path to open')
		.description('Open a project in the shared daemon')
		.action(async (projectPath: string) => {
			const { openProject } = await import('../projects.ts');
			await openProject(projectPath, version);
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
		.action(async (projectId: string, opts: ProjectsOptions) => {
			const { closeProject } = await import('../projects.ts');
			await closeProject(projectId, opts, version);
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
		.action(async (projectIdOrPath: string, opts: ProjectsOptions) => {
			const { forgetProject } = await import('../projects.ts');
			await forgetProject(projectIdOrPath, opts, version);
		});
}
