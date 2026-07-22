import { useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	getProjectConnectionState,
	onProjectConnectionState,
} from '@ottocode/web-sdk/lib';
import { configureDesktopSdk, configureMachineSdk } from '../../lib/sdk-client';
import type { Project, ServerInfo } from '../../lib/tauri-bridge';
import { resolveWorkspaceSdkConfiguration } from '../../lib/workspace-sdk-config';

interface DesktopWorkspaceProviderProps {
	apiUrl: string;
	server?: ServerInfo | null;
	project: Project;
	children: ReactNode;
}

function configureWorkspaceSdk(
	apiUrl: string,
	server: ServerInfo | null | undefined,
	project: Project,
) {
	const config = resolveWorkspaceSdkConfiguration(apiUrl, server, project);
	if (config.kind === 'machine') {
		configureMachineSdk(
			config.apiUrl,
			config.projectId,
			config.projectRoot,
			config.ownerSession,
			config.ownerSessionExpiresAt,
		);
		return;
	}
	configureDesktopSdk(config.apiUrl, config.server);
}

export function DesktopWorkspaceProvider({
	apiUrl,
	server,
	project,
	children,
}: DesktopWorkspaceProviderProps) {
	configureWorkspaceSdk(apiUrl, server, project);

	const queryClient = useMemo(() => {
		return new QueryClient({
			defaultOptions: {
				queries: {
					refetchOnWindowFocus: false,
					retry: 1,
					structuralSharing: true,
				},
			},
		});
	}, []);

	useEffect(() => {
		configureWorkspaceSdk(apiUrl, server, project);
	}, [apiUrl, server, project]);

	useEffect(() => {
		if (!project.remoteUrl) return;
		let connected = getProjectConnectionState().status === 'connected';
		let interrupted = false;
		return onProjectConnectionState((state) => {
			if (state.status === 'connected') {
				if (connected && interrupted) {
					void queryClient.refetchQueries({ type: 'active' });
				}
				connected = true;
				interrupted = false;
				return;
			}
			if (connected && state.status !== 'fallback') interrupted = true;
		});
	}, [project.remoteUrl, queryClient]);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
