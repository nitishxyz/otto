import {
	closeProject,
	forgetProject,
	getServerInfo,
	getTunnelStatus,
	listProjects,
	openProject,
	startTunnel,
	stopTunnel,
	type GetServerInfoResponse,
	type ListProjectsResponse,
	type OpenProjectResponse,
	type StartTunnelResponse,
	type StopTunnelResponse,
	type GetTunnelStatusResponse,
	type GetTunnelStatusData,
	type StartTunnelData,
	type StopTunnelData,
} from '@ottocode/api';

export interface DaemonApiOptions {
	baseUrl: string;
	token: string | null;
	fetch?: typeof fetch;
}

interface GeneratedResponse<T> {
	data?: T;
	error?: unknown;
	response?: { status: number; statusText?: string };
}

function describeError(error: unknown): string | null {
	if (typeof error === 'string') return error;
	if (!error || typeof error !== 'object') return null;
	for (const key of ['message', 'error', 'detail']) {
		const value = Reflect.get(error, key);
		if (typeof value === 'string' && value.length > 0) return value;
	}
	return null;
}

export function daemonAuthHeaders(
	token: string | null,
): Record<string, string> {
	return token
		? {
				Authorization: `Bearer ${token}`,
				'X-Otto-Server-Token': token,
			}
		: {};
}

function createFetchAdapter(fetchImpl: typeof fetch) {
	return async (config: {
		baseURL?: string;
		url?: string;
		method?: string;
		headers?: { toJSON?: () => object } | object;
		data?: string | null;
		signal?: AbortSignal;
	}) => {
		const headers =
			config.headers && 'toJSON' in config.headers && config.headers.toJSON
				? config.headers.toJSON()
				: config.headers;
		const response = await fetchImpl(
			new URL(config.url ?? '', config.baseURL).toString(),
			{
				method: config.method?.toUpperCase(),
				headers: headers as Record<string, string>,
				body: config.data,
				signal: config.signal,
			},
		);
		const text = await response.text();
		let data: unknown = text;
		if (text && response.headers.get('content-type')?.includes('json')) {
			data = JSON.parse(text);
		}
		const result = {
			data,
			status: response.status,
			statusText: response.statusText,
			headers: Object.fromEntries(response.headers),
			config,
			request: response,
		};
		if (!response.ok) {
			throw Object.assign(
				new Error(`Request failed with status ${response.status}`),
				{
					response: result,
					config,
				},
			);
		}
		return result;
	};
}

export function requireDaemonData<T>(
	action: string,
	result: GeneratedResponse<T>,
): T {
	if (result.data !== undefined && !result.error) return result.data;
	const detail = describeError(result.error);
	const suffix = detail ? `: ${detail}` : '';
	const status = result.response
		? `${result.response.status}${result.response.statusText ? ` ${result.response.statusText}` : ''}`
		: 'request error';
	throw new Error(`${action} failed (${status})${suffix}`);
}

/** Creates generated API operations configured for one daemon connection. */
export function createDaemonApi(options: DaemonApiOptions) {
	const request = {
		baseURL: options.baseUrl,
		headers: daemonAuthHeaders(options.token),
		adapter: (options.fetch
			? createFetchAdapter(options.fetch)
			: 'fetch') as never,
	};

	return {
		baseUrl: options.baseUrl,
		token: options.token,
		headers: request.headers,
		async getServerInfo(signal?: AbortSignal): Promise<GetServerInfoResponse> {
			return requireDaemonData<GetServerInfoResponse>(
				'Daemon health check',
				await getServerInfo({ ...request, signal }),
			);
		},
		async listProjects(): Promise<ListProjectsResponse['projects']> {
			const result = await listProjects(request);
			return requireDaemonData<ListProjectsResponse>('List projects', result)
				.projects;
		},
		async openProject(path: string): Promise<OpenProjectResponse> {
			return requireDaemonData<OpenProjectResponse>(
				'Open project',
				await openProject({ ...request, body: { path } }),
			);
		},
		async closeProject(projectId: string): Promise<void> {
			requireDaemonData(
				'Close project',
				await closeProject({ ...request, path: { projectId } }),
			);
		},
		async forgetProject(projectId: string): Promise<void> {
			requireDaemonData(
				'Forget project',
				await forgetProject({ ...request, path: { projectId } }),
			);
		},
		async startTunnel(
			body: StartTunnelData['body'],
		): Promise<StartTunnelResponse> {
			return requireDaemonData<StartTunnelResponse>(
				'Enable machine tunnel',
				await startTunnel({ ...request, body }),
			);
		},
		async getTunnelStatus(
			query: GetTunnelStatusData['query'],
		): Promise<GetTunnelStatusResponse> {
			return requireDaemonData<GetTunnelStatusResponse>(
				'Get machine tunnel status',
				await getTunnelStatus({ ...request, query }),
			);
		},
		async stopTunnel(
			query: StopTunnelData['query'],
		): Promise<StopTunnelResponse> {
			return requireDaemonData<StopTunnelResponse>(
				'Disable machine tunnel',
				await stopTunnel({ ...request, query }),
			);
		},
	};
}

export type DaemonApi = ReturnType<typeof createDaemonApi>;
