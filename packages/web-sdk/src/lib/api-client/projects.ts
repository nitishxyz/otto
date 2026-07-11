import { authenticatedFetch, getBaseUrl } from './utils';

export interface ProjectSummary {
	id: string;
	name: string;
	path: string;
	stateDir: string;
	dbPath: string;
	openedAt?: number;
	lastUsedAt: number;
	open: boolean;
}

async function projectRequest<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await authenticatedFetch(`${getBaseUrl()}${path}`, {
		...init,
		headers: {
			...(init?.body ? { 'content-type': 'application/json' } : {}),
			...init?.headers,
		},
	});
	if (!response.ok) {
		throw new Error(`Project request failed: ${response.status}`);
	}
	return (await response.json()) as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
	const body = await projectRequest<{ projects: ProjectSummary[] }>(
		'/v1/projects',
	);
	return body.projects;
}

export async function openProject(path: string): Promise<ProjectSummary> {
	return projectRequest<ProjectSummary>('/v1/projects/open', {
		method: 'POST',
		body: JSON.stringify({ path }),
	});
}

export async function closeProject(projectId: string): Promise<void> {
	await projectRequest<{ ok: boolean }>(
		`/v1/projects/${encodeURIComponent(projectId)}/close`,
		{ method: 'DELETE' },
	);
}

export async function forgetProject(projectIdOrPath: string): Promise<void> {
	await projectRequest<{ ok: boolean }>(
		`/v1/projects/${encodeURIComponent(projectIdOrPath)}`,
		{ method: 'DELETE' },
	);
}
