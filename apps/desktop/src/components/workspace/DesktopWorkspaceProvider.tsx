import { useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

		return new QueryClient({
			defaultOptions: {
				queries: {
					refetchOnWindowFocus: false,
					retry: 1,
					structuralSharing: true,
				},
			},
		});
	}, [apiUrl, server]);

	useEffect(() => {
		configureDesktopSdk(apiUrl, server);
	}, [apiUrl, server]);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
