import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMCPStore, type MCPServerInfo } from '../stores/mcpStore';
import { useEffect, useRef, useCallback } from 'react';
import {
	listMcpServers,
	startMcpServer,
	stopMcpServer,
	addMcpServer,
	removeMcpServer,
	initiateMcpAuth,
	revokeMcpAuth,
	getMcpAuthStatus,
	completeMcpAuth,
} from '@ottocode/api';
import { startLoopbackOAuthProxy } from '../lib/oauth-callback-proxy';

interface MCPServersResponse {
	servers: MCPServerInfo[];
}

export function useMCPServers() {
	const setServers = useMCPStore((s) => s.setServers);

	const query = useQuery({
		queryKey: ['mcp', 'servers'],
		queryFn: async () => {
			const { data } = await listMcpServers();
			return data as MCPServersResponse;
		},
		refetchInterval: 10000,
	});

	useEffect(() => {
		if (query.data?.servers) {
			setServers(query.data.servers);
		}
	}, [query.data, setServers]);

	return query;
}

export function useStartMCPServer() {
	const queryClient = useQueryClient();
	const updateServer = useMCPStore((s) => s.updateServer);

	return useMutation({
		mutationFn: async (name: string) => {
			const { data, error } = await startMcpServer({
				path: { name },
			});
			if (error) throw new Error('Failed to start server');
			const result = data as {
				ok: boolean;
				error?: string;
				connected?: boolean;
				authRequired?: boolean;
				authUrl?: string;
				authType?: string;
				authenticated?: boolean;
				flowId?: string;
				callbackUrl?: string;
				callbackProxyStarted?: boolean;
				callbackProxyOpened?: boolean;
				sessionId?: string;
				userCode?: string;
				verificationUri?: string;
				interval?: number;
			};
			if (!result.ok) throw new Error(result.error || 'Failed to start server');
			const proxy = await startLoopbackOAuthProxy(result);
			return {
				...result,
				callbackProxyStarted: proxy.proxied,
				callbackProxyOpened: proxy.opened,
			};
		},
		onMutate: (name) => {
			const previous = useMCPStore
				.getState()
				.servers.find((server) => server.name === name)?.disabled;
			updateServer(name, { disabled: false });
			return { previous };
		},
		onError: (_error, name, context) => {
			if (context?.previous !== undefined) {
				updateServer(name, { disabled: context.previous });
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		},
	});
}

export function useStopMCPServer() {
	const queryClient = useQueryClient();
	const setLoading = useMCPStore((s) => s.setLoading);
	const updateServer = useMCPStore((s) => s.updateServer);

	return useMutation({
		mutationFn: async (name: string) => {
			setLoading(name, true);
			const { data, error } = await stopMcpServer({
				path: { name },
			});
			if (error) throw new Error('Failed to stop server');
			const result = data as { ok: boolean; error?: string };
			if (!result.ok) throw new Error(result.error || 'Failed to stop server');
			return result;
		},
		onMutate: (name) => {
			const previous = useMCPStore
				.getState()
				.servers.find((server) => server.name === name)?.disabled;
			updateServer(name, { disabled: true });
			return { previous };
		},
		onError: (_error, name, context) => {
			if (context?.previous !== undefined) {
				updateServer(name, { disabled: context.previous });
			}
		},
		onSettled: (_data, _error, name) => {
			setLoading(name, false);
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		},
	});
}

export interface AddMCPServerParams {
	name: string;
	transport?: 'stdio' | 'http' | 'sse';
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	oauth?: Record<string, unknown>;
	scope?: 'global' | 'project';
}

export function useAddMCPServer() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (params: AddMCPServerParams) => {
			const { data, error } = await addMcpServer({
				body: params,
			});
			if (error) throw new Error('Failed to add MCP server');
			const result = data as { ok: boolean; error?: string };
			if (!result.ok)
				throw new Error(result.error || 'Failed to add MCP server');
			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		},
	});
}

export function useRemoveMCPServer() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (name: string) => {
			const { data, error } = await removeMcpServer({
				path: { name },
			});
			if (error) throw new Error('Failed to remove MCP server');
			const result = data as { ok: boolean; error?: string };
			if (!result.ok)
				throw new Error(result.error || 'Failed to remove MCP server');
			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		},
	});
}

export function useAuthenticateMCPServer() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (name: string) => {
			const { data, error } = await initiateMcpAuth({
				path: { name },
			});
			if (error) throw new Error('Failed to initiate auth');
			const result = data as {
				ok: boolean;
				authUrl?: string;
				authType?: string;
				sessionId?: string;
				userCode?: string;
				verificationUri?: string;
				interval?: number;
				authenticated?: boolean;
				flowId?: string;
				callbackUrl?: string;
				callbackProxyStarted?: boolean;
				callbackProxyOpened?: boolean;
				name: string;
				error?: string;
			};
			if (!result.ok)
				throw new Error(result.error || 'Failed to initiate auth');
			const proxy = await startLoopbackOAuthProxy(result);
			return {
				...result,
				callbackProxyStarted: proxy.proxied,
				callbackProxyOpened: proxy.opened,
			};
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		},
	});
}

export function useRevokeMCPAuth() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (name: string) => {
			const { data, error } = await revokeMcpAuth({
				path: { name },
			});
			if (error) throw new Error('Failed to revoke auth');
			const result = data as { ok: boolean; error?: string };
			if (!result.ok) throw new Error(result.error || 'Failed to revoke auth');
			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		},
	});
}

export function useMCPAuthStatus(name: string | null) {
	return useQuery({
		queryKey: ['mcp', 'auth', name],
		queryFn: async () => {
			if (!name) return { authenticated: false };
			const { data } = await getMcpAuthStatus({
				path: { name },
			});
			return data as {
				authenticated: boolean;
				expiresAt?: number;
			};
		},
		enabled: !!name,
		refetchInterval: 3000,
	});
}

export function useCopilotDevicePoller() {
	const copilotDevice = useMCPStore((s) => s.copilotDevice);
	const setCopilotDevice = useMCPStore((s) => s.setCopilotDevice);
	const setLoading = useMCPStore((s) => s.setLoading);
	const queryClient = useQueryClient();
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const stopPolling = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (!copilotDevice) {
			stopPolling();
			return;
		}

		const { sessionId, serverName, interval } = copilotDevice;
		const pollMs = (interval || 5) * 1000 + 1000;

		timerRef.current = setInterval(async () => {
			try {
				const { data } = await completeMcpAuth({
					path: { name: serverName },
					body: { sessionId },
				});

				const result = data as {
					ok: boolean;
					status: string;
					error?: string;
				};

				if (result?.status === 'complete') {
					stopPolling();
					setCopilotDevice(null);
					setLoading(serverName, false);
					queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
				} else if (result?.status === 'error') {
					stopPolling();
					setCopilotDevice(null);
					setLoading(serverName, false);
				}
			} catch {
				stopPolling();
				setCopilotDevice(null);
				setLoading(serverName, false);
			}
		}, pollMs);

		return stopPolling;
	}, [copilotDevice, setCopilotDevice, setLoading, queryClient, stopPolling]);

	return copilotDevice;
}
