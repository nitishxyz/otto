import { useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@ottocode/web-sdk/lib';
import { configureDesktopSdk } from '../../lib/sdk-client';
import type { ServerInfo } from '../../lib/tauri-bridge';

interface DesktopWorkspaceProviderProps {
	apiUrl: string;
	server?: ServerInfo | null;
	children: ReactNode;
}

export function DesktopWorkspaceProvider({
	apiUrl,
	server,
	children,
}: DesktopWorkspaceProviderProps) {
	configureDesktopSdk(apiUrl, server);

	const queryClient = useMemo(() => {
		configureDesktopSdk(apiUrl, server);

		const client = new QueryClient({
			defaultOptions: {
				queries: {
					refetchOnWindowFocus: false,
					retry: 1,
					structuralSharing: true,
				},
			},
		});

		client.prefetchQuery({
			queryKey: ['sessions'],
			queryFn: () => apiClient.getSessions(),
		});
		client.prefetchQuery({
			queryKey: ['config'],
			queryFn: () => apiClient.getConfig(),
		});

		return client;
	}, [apiUrl, server]);

	useEffect(() => {
		configureDesktopSdk(apiUrl, server);
	}, [apiUrl, server]);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
