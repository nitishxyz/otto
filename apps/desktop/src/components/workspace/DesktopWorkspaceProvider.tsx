import { useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@ottocode/web-sdk/lib';
import { configureDesktopSdk } from '../../lib/sdk-client';

interface DesktopWorkspaceProviderProps {
	apiUrl: string;
	children: ReactNode;
}

export function DesktopWorkspaceProvider({
	apiUrl,
	children,
}: DesktopWorkspaceProviderProps) {
	configureDesktopSdk(apiUrl);

	const queryClient = useMemo(() => {
		configureDesktopSdk(apiUrl);

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
	}, [apiUrl]);

	useEffect(() => {
		configureDesktopSdk(apiUrl);
	}, [apiUrl]);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
