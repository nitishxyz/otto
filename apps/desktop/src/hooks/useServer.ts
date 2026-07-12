import { openProject } from '@ottocode/api';
import { useState, useCallback, useRef } from 'react';
import { tauriBridge, type ServerInfo } from '../lib/tauri-bridge';
import { configureDesktopSdk } from '../lib/sdk-client';

async function waitForServer(
	server: ServerInfo,
	maxAttempts = 60,
): Promise<boolean> {
	const apiUrl = `${server.url}/v1/server/info`;

	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(apiUrl, {
				method: 'GET',
				headers: server.token
					? {
							Authorization: `Bearer ${server.token}`,
							'X-Otto-Server-Token': server.token,
						}
					: undefined,
			});
			if (response.ok) {
				return true;
			}
		} catch {
			// Server not ready yet
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

export function useServer() {
	const [server, setServer] = useState<ServerInfo | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const startingRef = useRef(false);
	const serverRef = useRef<ServerInfo | null>(null);

	const startServer = useCallback(async (projectPath: string) => {
		if (startingRef.current) return null;
		startingRef.current = true;

		try {
			setLoading(true);
			setError(null);

			const daemon = await tauriBridge.ensureDesktopDaemon();

			const ready = await waitForServer(daemon);
			if (ready) {
				configureDesktopSdk(daemon.url, daemon);
				const response = await openProject({ body: { path: projectPath } });
				if (response.error || !response.data) {
					throw new Error('Could not open project.');
				}
				const info: ServerInfo = {
					...daemon,
					projectId: response.data.id,
					projectPath: response.data.path,
				};
				setServer(info);
				serverRef.current = info;
				return info;
			} else {
				throw new Error('Server started but not responding after 15s');
			}
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to start server';
			setError(message);
			return null;
		} finally {
			setLoading(false);
			startingRef.current = false;
		}
	}, []);

	const stopServer = useCallback(async () => {
		setServer(null);
		serverRef.current = null;
	}, []);

	return {
		server,
		loading,
		error,
		isRunning: !!server,
		startServer,
		stopServer,
	};
}
