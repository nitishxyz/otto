import { useState, useCallback, useRef } from 'react';
import { tauriBridge, type ServerInfo } from '../lib/tauri-bridge';

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

	const startServer = useCallback(
		async (projectPath: string, port?: number) => {
			if (startingRef.current) return null;
			startingRef.current = true;

			try {
				setLoading(true);
				setError(null);

				// Ensure/reuse the shared daemon and open this project on it.
				const info = await tauriBridge.startServer(projectPath, port);

				const ready = await waitForServer(info);
				if (ready) {
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
		},
		[],
	);

	const stopServer = useCallback(async () => {
		const currentServer = serverRef.current;
		if (!currentServer) return;
		try {
			await tauriBridge.stopServer(currentServer.pid);
		} catch (err) {
			console.error('Failed to stop server:', err);
		}
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
