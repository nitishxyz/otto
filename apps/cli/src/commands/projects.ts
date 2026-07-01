import type { Command } from 'commander';
import {
	closeProjectOnServer,
	ensureDaemon,
	forgetProjectOnServer,
	listProjectsOnServer,
	openProjectOnServer,
	readDaemonToken,
	type DaemonProjectSummary,
} from '../daemon.ts';

interface ProjectsOptions {
	project?: string;
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

export function formatProjectsList(projects: DaemonProjectSummary[]): string {
	if (projects.length === 0) return 'No otto projects known yet.';
	return projects
		.map((project) => {
			const state = project.open ? 'open' : 'known';
			return [
				`${project.open ? '*' : ' '} ${project.name}`,
				`  id: ${project.id}`,
				`  path: ${project.path}`,
				`  state: ${state}`,
				`  last used: ${formatDate(project.lastUsedAt)}`,
			].join('\n');
		})
		.join('\n\n');
}

async function daemonConnection(version: string, projectRoot?: string) {
	const registration = await ensureDaemon({ version, projectRoot });
	const token = await readDaemonToken();
	return { baseUrl: registration.url, token };
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
		.action(async (opts: ProjectsOptions) => {
			const connection = await daemonConnection(version, opts.project);
			const items = await listProjectsOnServer(connection);
			console.log(formatProjectsList(items));
		});

	projects
		.command('open')
		.argument('<path>', 'Project path to open')
		.description('Open a project in the shared daemon')
		.action(async (projectPath: string) => {
			const connection = await daemonConnection(version, projectPath);
			const project = await openProjectOnServer({
				...connection,
				projectRoot: projectPath,
			});
			console.log(`opened ${project.projectRoot}`);
			console.log(`id: ${project.projectId}`);
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
			const connection = await daemonConnection(version, opts.project);
			await closeProjectOnServer({ ...connection, projectId });
			console.log(`closed ${projectId}`);
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
			const connection = await daemonConnection(version, opts.project);
			await forgetProjectOnServer({ ...connection, projectIdOrPath });
			console.log(`forgot ${projectIdOrPath}`);
		});
}
