import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useRef } from 'react';
import {
	client,
	getTunnelQr,
	getTunnelStatus,
	startTunnel as apiStartTunnel,
	stopTunnel as apiStopTunnel,
} from '@ottocode/api';
import {
	useTunnelStore,
	type TunnelScope,
	type TunnelStatus,
} from '../stores/tunnelStore';
import { getProjectId } from '../lib/api-client/utils';
import { API_BASE_URL } from '../lib/config';

interface TunnelStatusResponse {
	scope: TunnelScope;
	projectId: string | null;
	status: TunnelStatus;
	url: string | null;
	error: string | null;
	binaryInstalled: boolean;
	isRunning: boolean;
}

interface TunnelStartResponse {
	ok: boolean;
	url?: string | null;
	message?: string;
	error?: string;
}

interface TunnelQrResponse {
	ok: boolean;
	url?: string;
	qrCode?: string;
	error?: string;
}

export interface TunnelScopeArgs {
	scope: TunnelScope;
	projectId?: string | null;
}

function scopeQuery(args: TunnelScopeArgs) {
	const query: { scope: TunnelScope; projectId?: string } = {
		scope: args.scope,
	};
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

function normalizeTunnelStatus(data: {
	status: TunnelStatus;
	url: string | null;
	isRunning?: boolean;
}): TunnelStatus {
	if (data.isRunning && data.url) return 'connected';
	if (data.isRunning && data.status === 'idle') return 'starting';
	if (data.status === 'connected' && !data.url) return 'starting';
	return data.status;
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
			...(projectId ? { projectId } : {}),
		},
	});
	if (response.error) throw new Error(JSON.stringify(response.error));
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
	if (response.error) throw new Error(JSON.stringify(response.error));
	return response.data as { ok: boolean; message?: string; error?: string };
}

async function fetchTunnelQr(args: TunnelScopeArgs): Promise<TunnelQrResponse> {
	const response = await getTunnelQr({
		query: scopeQuery({ ...args, projectId: resolveProjectId(args) }),
	});
	if (response.error) throw new Error(JSON.stringify(response.error));
	return response.data as TunnelQrResponse;
}

export function useTunnelStatus(args: TunnelScopeArgs) {
	const patchScope = useTunnelStore((s) => s.patchScope);

	const query = useQuery<TunnelStatusResponse>({
		queryKey: ['tunnel', 'status', args.scope, resolveProjectId(args) ?? null],
		queryFn: () => fetchTunnelStatus(args),
		refetchInterval: 3000,
		refetchOnMount: 'always',
		enabled: isProjectShareReady(args),
	});

	useEffect(() => {
		if (query.data) {
			patchScope(args.scope, {
				status: normalizeTunnelStatus(query.data),
				url: query.data.url,
				error: query.data.error,
			});
		}
	}, [query.data, patchScope, args.scope]);

	return query;
}

export function useStartTunnel(args: TunnelScopeArgs) {
	const queryClient = useQueryClient();
	const patchScope = useTunnelStore((s) => s.patchScope);

	return useMutation<TunnelStartResponse, Error, void>({
		mutationFn: () => startTunnel(args),
		onMutate: () => {
			patchScope(args.scope, {
				status: 'starting',
				progress: 'Connecting...',
				error: null,
			});
		},
		onSuccess: (data) => {
			if (data.ok) {
				if (data.url) {
					patchScope(args.scope, {
						status: 'connected',
						url: data.url,
						progress: null,
					});
				} else {
					patchScope(args.scope, { progress: null });
				}
			} else {
				patchScope(args.scope, {
					status: 'error',
					error: data.error || 'Failed to start tunnel',
					progress: null,
				});
			}
			queryClient.invalidateQueries({ queryKey: ['tunnel'] });
		},
		onError: (error) => {
			patchScope(args.scope, {
				status: 'error',
				error: error.message,
				progress: null,
			});
		},
	});
}

export function useStopTunnel(args: TunnelScopeArgs) {
	const queryClient = useQueryClient();
	const resetScope = useTunnelStore((s) => s.resetScope);

	return useMutation({
		mutationFn: () => stopTunnel(args),
		onSuccess: () => {
			resetScope(args.scope);
			queryClient.invalidateQueries({ queryKey: ['tunnel'] });
		},
	});
}

export function useTunnelQr(args: TunnelScopeArgs) {
	const url = useTunnelStore((s) =>
		args.scope === 'project-share' ? s.projectShare.url : s.remoteControl.url,
	);

	return useQuery<TunnelQrResponse>({
		queryKey: ['tunnel', 'qr', args.scope, resolveProjectId(args) ?? null, url],
		queryFn: () => fetchTunnelQr(args),
		enabled: !!url && isProjectShareReady(args),
	});
}

export function useTunnelStream(args: TunnelScopeArgs) {
	const patchScope = useTunnelStore((s) => s.patchScope);
	const isExpanded = useTunnelStore((s) => s.isExpanded);
	const eventSourceRef = useRef<EventSource | null>(null);

	const projectId = resolveProjectId(args);
	const ready = isProjectShareReady(args);

	const connect = useCallback(() => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
		}

		const query: Record<string, string> = { scope: args.scope };
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
					patchScope(args.scope, {
						status: normalizeTunnelStatus(data),
						url: data.url,
						error: data.error,
						progress: data.progress,
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
	}, [patchScope, args.scope, projectId]);

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
