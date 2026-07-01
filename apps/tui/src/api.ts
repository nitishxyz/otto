import { client } from '@ottocode/api';

const DEFAULT_PORT = 9100;

let overridePort: number | null = null;
let overrideBaseUrl: string | null = null;
let projectId: string | null = process.env.OTTO_PROJECT_ID || null;
let projectRoot: string | null = process.env.OTTO_PROJECT_ROOT || null;
let authToken: string | null = process.env.OTTO_SERVER_TOKEN || null;

export function setPort(port: number) {
	overridePort = port;
}

export function configureProjectContext(options: {
	baseUrl?: string;
	projectId?: string;
	projectRoot?: string;
	token?: string | null;
}) {
	overrideBaseUrl = options.baseUrl ?? overrideBaseUrl;
	projectId = options.projectId ?? projectId;
	projectRoot = options.projectRoot ?? projectRoot;
	authToken = options.token ?? authToken;
}

export function getBaseUrl(): string {
	if (overrideBaseUrl) return overrideBaseUrl;
	if (process.env.OTTO_SERVER_URL) return process.env.OTTO_SERVER_URL;
	const port =
		overridePort ??
		(process.env.OTTO_PORT ? Number(process.env.OTTO_PORT) : DEFAULT_PORT);
	return `http://127.0.0.1:${port}`;
}

export function getProjectContext() {
	return { projectId, projectRoot, authToken };
}

export function getProjectQuery() {
	return {
		...(projectId ? { projectId } : {}),
		...(projectRoot ? { project: projectRoot } : {}),
	};
}

export function getProjectKey(): string {
	return projectId || projectRoot || 'default';
}

export function configureApi() {
	client.setConfig({
		baseURL: getBaseUrl(),
		headers: {
			...(authToken
				? {
						Authorization: `Bearer ${authToken}`,
						'X-Otto-Server-Token': authToken,
					}
				: {}),
			...(projectId ? { 'X-Otto-Project-Id': projectId } : {}),
			...(projectRoot ? { 'X-Otto-Project': projectRoot } : {}),
		},
	});
}
