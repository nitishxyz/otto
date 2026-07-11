import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useRef } from 'react';
import {
	client,
	createTunnelShare as apiCreateTunnelShare,
	getTunnelQr,
	getTunnelStatus,
	listTunnelShares as apiListTunnelShares,
	revokeTunnelShare as apiRevokeTunnelShare,
	startTunnel as apiStartTunnel,
	stopTunnel as apiStopTunnel,
} from '@ottocode/api';
import {
	tunnelSlotKey,
	useTunnelStore,
	type TunnelMode,
	type TunnelScope,
	type TunnelStatus,
} from '../stores/tunnelStore';
import { getProjectId } from '../lib/api-client/utils';
import { API_BASE_URL } from '../lib/config';
import {
	describeTunnelActionError,
	normalizeTunnelStatus,
} from '../lib/tunnel-shared';

interface TunnelStatusResponse {
	mode: TunnelMode;
	scope: TunnelScope;
	projectId: string | null;
	status: TunnelStatus;
	url: string | null;
	error: string | null;
	binaryInstalled: boolean;
	isRunning: boolean;
	hostname: string | null;
	ottorouterConnected: boolean;
}

interface TunnelStartResponse {
	ok: boolean;
	url?: string | null;
	message?: string;
	code?: string;
	error?: string;
}

interface TunnelQrResponse {
	ok: boolean;
	url?: string;
	qrCode?: string;
	error?: string;
}

export interface TunnelShare {
	id: string;
	projectId: string;
	token: string;
	url: string;
	createdAt: number;
}

export interface TunnelScopeArgs {
	scope: TunnelScope;
	mode?: TunnelMode;
	projectId?: string | null;
}

function scopeQuery(args: TunnelScopeArgs) {
	const query: { scope: TunnelScope; mode?: TunnelMode; projectId?: string } = {
		scope: args.scope,
	};
	if (args.mode) query.mode = args.mode;
	if (args.scope === 'project-share' && args.projectId) {
		query.projectId = args.projectId;
	}
	return query;
}

function resolveProjectId(args: TunnelScopeArgs): string | undefined {
	if (args.scope !== 'project-share') return undefined;
	return args.projectId ?? getProjectId() ?? undefined;
}

function isProjectShareReady(args: TunnelScopeArgs): boolean {
	return args.scope !== 'project-share' || Boolean(resolveProjectId(args));
}

async function fetchTunnelStatus(
	args: TunnelScopeArgs,
): Promise<TunnelStatusResponse> {
	const response = await getTunnelStatus({
		query: scopeQuery({ ...args, projectId: resolveProjectId(args) }),
	});
	if (response.error) throw new Error(JSON.stringify(response.error));
	return response.data as TunnelStatusResponse;
}

async function startTunnel(
	args: TunnelScopeArgs,
): Promise<TunnelStartResponse> {
	const projectId = resolveProjectId(args);
	const response = await apiStartTunnel({
		body: {
			scope: args.scope,
			...(args.mode ? { mode: args.mode } : {}),
			...(projectId ? { projectId } : {}),
		},
	});
	if (response.error) {
		const data = response.data as TunnelStartResponse | undefined;
		if (data && data.ok === false) return data;
		throw new Error(describeTunnelActionError(response.error));
	}
	return response.data as TunnelStartResponse;
}

async function stopTunnel(args: TunnelScopeArgs): Promise<{
	ok: boolean;
	message?: string;
	error?: string;
}> {
	const response = await apiStopTunnel({
		query: scopeQuery({ ...args, projectId: resolveProjectId(args) }),
	});
	if (response.error)
		throw new Error(describeTunnelActionError(response.error));
	return response.data as { ok: boolean; message?: string; error?: string };
}

async function fetchTunnelQr(args: TunnelScopeArgs): Promise<TunnelQrResponse> {
	const response = await getTunnelQr({
		query: scopeQuery({ ...args, projectId: resolveProjectId(args) }),
	});
	if (response.error) throw new Error(JSON.stringify(response.error));
	return response.data as TunnelQrResponse;
}

/**
 * Polls daemon tunnel status for one (scope, mode) pair and mirrors it into
 * that pair's dedicated store slot, so e.g. a quick-mode poll can never
 * overwrite live managed remote-control state. Refetches on window focus and
 * every 3s while mounted, keeping the sidebar in sync with changes made from
 * other surfaces (desktop Machines tab, CLI).
 */
export function useTunnelStatus(args: TunnelScopeArgs) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const patchSlot = useTunnelStore((s) => s.patchSlot);

	const setOttorouterConnected = useTunnelStore(
		(s) => s.setOttorouterConnected,
	);

	const query = useQuery<TunnelStatusResponse>({
		queryKey: [
			'tunnel',
			'status',
			args.scope,
			args.mode ?? 'quick',
			resolveProjectId(args) ?? null,
		],
		queryFn: () => fetchTunnelStatus(args),
		refetchInterval: 3000,
		refetchOnMount: 'always',
		refetchOnWindowFocus: 'always',
		enabled: isProjectShareReady(args),
	});

	useEffect(() => {
		if (query.data) {
			patchSlot(slot, {
				status: normalizeTunnelStatus(query.data),
				url: query.data.url,
				error: query.data.error,
				hostname: query.data.hostname,
			});
			setOttorouterConnected(query.data.ottorouterConnected);
		}
	}, [query.data, patchSlot, setOttorouterConnected, slot]);

	return query;
}

export function useStartTunnel(args: TunnelScopeArgs) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const queryClient = useQueryClient();
	const patchSlot = useTunnelStore((s) => s.patchSlot);

	return useMutation<TunnelStartResponse, Error, void>({
		mutationFn: () => startTunnel(args),
		onMutate: () => {
			patchSlot(slot, {
				status: 'starting',
				progress: 'Connecting...',
				error: null,
			});
		},
		onSuccess: (data) => {
			if (data.ok) {
				if (data.url) {
					patchSlot(slot, {
						status: 'connected',
						url: data.url,
						progress: null,
					});
				} else {
					patchSlot(slot, { progress: null });
				}
			} else {
				patchSlot(slot, {
					status: 'error',
					error: describeTunnelActionError(data),
					progress: null,
				});
			}
			queryClient.invalidateQueries({ queryKey: ['tunnel'] });
		},
		onError: (error) => {
			patchSlot(slot, {
				status: 'error',
				error: error.message,
				progress: null,
			});
		},
	});
}

export function useStopTunnel(args: TunnelScopeArgs) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const queryClient = useQueryClient();
	const resetSlot = useTunnelStore((s) => s.resetSlot);

	return useMutation({
		mutationFn: () => stopTunnel(args),
		onSuccess: () => {
			resetSlot(slot);
			queryClient.invalidateQueries({ queryKey: ['tunnel'] });
		},
	});
}

export function useTunnelQr(args: TunnelScopeArgs) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const url = useTunnelStore((s) => s[slot].url);

	return useQuery<TunnelQrResponse>({
		queryKey: [
			'tunnel',
			'qr',
			args.scope,
			args.mode ?? 'quick',
			resolveProjectId(args) ?? null,
			url,
		],
		queryFn: () => fetchTunnelQr(args),
		enabled: !!url && isProjectShareReady(args),
	});
}

/**
 * Subscribes to the daemon SSE tunnel stream for one (scope, mode) pair and
 * mirrors events into that pair's store slot while the sidebar is expanded.
 */
export function useTunnelStream(args: TunnelScopeArgs) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const patchSlot = useTunnelStore((s) => s.patchSlot);
	const isExpanded = useTunnelStore((s) => s.isExpanded);
	const eventSourceRef = useRef<EventSource | null>(null);

	const projectId = resolveProjectId(args);
	const ready = isProjectShareReady(args);

	const connect = useCallback(() => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
		}

		const query: Record<string, string> = { scope: args.scope };
		if (args.mode) query.mode = args.mode;
		if (args.scope === 'project-share' && projectId) {
			query.projectId = projectId;
		}

		const es = new EventSource(
			client.buildUrl({
				baseURL: API_BASE_URL,
				url: '/v1/tunnel/stream',
				query,
			}),
		);
		eventSourceRef.current = es;

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.type === 'status') {
					patchSlot(slot, {
						status: normalizeTunnelStatus(data),
						url: data.url,
						error: data.error,
						progress: data.progress,
						...(typeof data.hostname !== 'undefined'
							? { hostname: data.hostname }
							: {}),
					});
				}
			} catch {
				// ignore parse errors
			}
		};

		es.onerror = () => {
			es.close();
			eventSourceRef.current = null;
		};

		return () => {
			es.close();
			eventSourceRef.current = null;
		};
	}, [patchSlot, slot, args.scope, args.mode, projectId]);

	useEffect(() => {
		if (isExpanded && ready) {
			const cleanup = connect();
			return cleanup;
		}
		return () => {
			if (eventSourceRef.current) {
				eventSourceRef.current.close();
				eventSourceRef.current = null;
			}
		};
	}, [isExpanded, ready, connect]);

	return { connect };
}

const TUNNEL_SHARES_KEY = ['tunnel', 'shares'] as const;

/** Lists active managed project shares. */
export function useTunnelShares(enabled = true) {
	return useQuery<TunnelShare[]>({
		queryKey: TUNNEL_SHARES_KEY,
		queryFn: async () => {
			const response = await apiListTunnelShares();
			if (response.error) throw new Error(JSON.stringify(response.error));
			return (response.data?.shares ?? []) as TunnelShare[];
		},
		enabled,
		refetchInterval: 5000,
	});
}

/** Creates a managed project share for the given project. */
export function useCreateTunnelShare() {
	const queryClient = useQueryClient();
	return useMutation<TunnelShare, Error, string>({
		mutationFn: async (projectId: string) => {
			const response = await apiCreateTunnelShare({ body: { projectId } });
			if (response.error) throw new Error(extractShareError(response.error));
			return response.data as TunnelShare;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: TUNNEL_SHARES_KEY });
		},
	});
}

/** Revokes a managed project share by id. */
export function useRevokeTunnelShare() {
	const queryClient = useQueryClient();
	return useMutation<void, Error, string>({
		mutationFn: async (id: string) => {
			const response = await apiRevokeTunnelShare({ path: { id } });
			if (response.error) throw new Error(extractShareError(response.error));
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: TUNNEL_SHARES_KEY });
		},
	});
}

function extractShareError(error: unknown): string {
	if (error && typeof error === 'object' && 'error' in error) {
		const message = (error as { error?: unknown }).error;
		if (typeof message === 'string') return message;
	}
	return JSON.stringify(error);
}
