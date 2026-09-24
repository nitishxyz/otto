import type {
	ActivityResponse,
	GraphResponse,
	MemoryDetailResponse,
	ScopesResponse,
	SearchResponse,
} from './types.ts';

const BASE = '/api';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		signal,
		headers: { accept: 'application/json' },
	});
	if (!res.ok) {
		throw new Error(`${path} -> ${res.status}`);
	}
	return (await res.json()) as T;
}

type QueryValue = string | number | boolean | undefined;

function query(params: { [key: string]: QueryValue }) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === '') continue;
		search.set(key, String(value));
	}
	const text = search.toString();
	return text ? `?${text}` : '';
}

export interface GraphQuery {
	[key: string]: QueryValue;
	projectId?: string;
	scope?: string;
	includeSuperseded?: boolean;
	limit?: number;
}

export const api = {
	graph: (params: GraphQuery, signal?: AbortSignal) =>
		getJson<GraphResponse>(`/graph${query(params)}`, signal),
	memory: (id: string, signal?: AbortSignal) =>
		getJson<MemoryDetailResponse>(
			`/memories/${encodeURIComponent(id)}`,
			signal,
		),
	activity: (
		params: { sinceId?: string; limit?: number },
		signal?: AbortSignal,
	) => getJson<ActivityResponse>(`/activity${query(params)}`, signal),
	scopes: (signal?: AbortSignal) => getJson<ScopesResponse>('/scopes', signal),
	search: (q: string, projectId?: string, signal?: AbortSignal) =>
		getJson<SearchResponse>(`/search${query({ q, projectId })}`, signal),
	eventsUrl: `${BASE}/events`,
};
