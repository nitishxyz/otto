import { connectDaemonApi, type DaemonProjectSummary } from '../daemon.ts';

export interface ProjectsOptions {
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

export async function listProjects(opts: ProjectsOptions, version: string) {
	const api = await connectDaemonApi({ version, projectRoot: opts.project });
	const items = await api.listProjects();
	console.log(formatProjectsList(items));
}

export async function openProject(projectPath: string, version: string) {
	const api = await connectDaemonApi({ version, projectRoot: projectPath });
	const project = await api.openProject(projectPath);
	console.log(`opened ${project.path}`);
	console.log(`id: ${project.id}`);
}

export async function closeProject(
	projectId: string,
	opts: ProjectsOptions,
	version: string,
) {
	const api = await connectDaemonApi({ version, projectRoot: opts.project });
	await api.closeProject(projectId);
	console.log(`closed ${projectId}`);
}

export async function forgetProject(
	projectIdOrPath: string,
	opts: ProjectsOptions,
	version: string,
) {
	const api = await connectDaemonApi({ version, projectRoot: opts.project });
	await api.forgetProject(projectIdOrPath);
	console.log(`forgot ${projectIdOrPath}`);
}
