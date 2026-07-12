import { useState, useEffect, useCallback, useRef } from 'react';
import {
	cloneGitHubRepository,
	disconnectGitHub,
	getGitHubStatus,
	listGitHubRepositories,
	pollGitHubDeviceFlow,
	startGitHubDeviceFlow,
} from '@ottocode/api';

export interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	clone_url: string;
	private: boolean;
	description: string | null;
}

export interface GitHubUser {
	login: string;
	name: string | null;
	avatar_url: string;
}

export interface DeviceCodeResponse {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	interval: number;
	expiresIn: number;
}

function errorMessage(error: unknown, fallback: string): string {
	if (error && typeof error === 'object' && 'error' in error) {
		const message = (error as { error?: unknown }).error;
		if (typeof message === 'string') return message;
	}
	return fallback;
}

function toUser(user: {
	login: string;
	name: string | null;
	avatarUrl: string;
}): GitHubUser {
	return { login: user.login, name: user.name, avatar_url: user.avatarUrl };
}

function toRepo(repo: {
	id: number;
	name: string;
	fullName: string;
	cloneUrl: string;
	private: boolean;
	description: string | null;
}): GitHubRepo {
	return {
		id: repo.id,
		name: repo.name,
		full_name: repo.fullName,
		clone_url: repo.cloneUrl,
		private: repo.private,
		description: repo.description,
	};
}

export type OAuthState =
	| { step: 'idle' }
	| { step: 'requesting' }
	| { step: 'awaiting_user'; deviceCode: DeviceCodeResponse }
	| { step: 'polling' }
	| { step: 'complete' }
	| { step: 'error'; message: string };

export function useGitHub() {
	const [user, setUser] = useState<GitHubUser | null>(null);
	const [repos, setRepos] = useState<GitHubRepo[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [oauthState, setOAuthState] = useState<OAuthState>({ step: 'idle' });
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const stopPolling = useCallback(() => {
		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}
	}, []);

	const loadStatus = useCallback(async () => {
		try {
			const response = await getGitHubStatus();
			if (response.error)
				throw new Error(
					errorMessage(response.error, 'Failed to load GitHub status'),
				);
			setUser(
				response.data?.connected && response.data.user
					? toUser(response.data.user)
					: null,
			);
		} catch (err) {
			console.error('Failed to load GitHub status:', err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadStatus();
		return stopPolling;
	}, [loadStatus, stopPolling]);

	const startOAuth = useCallback(async () => {
		try {
			setOAuthState({ step: 'requesting' });
			const response = await startGitHubDeviceFlow();
			if (response.error || !response.data) {
				throw new Error(errorMessage(response.error, 'Failed to start OAuth'));
			}
			const deviceCode: DeviceCodeResponse = {
				deviceCode: response.data.sessionId,
				userCode: response.data.userCode,
				verificationUri: response.data.verificationUri,
				interval: response.data.interval,
				expiresIn: response.data.expiresIn,
			};
			setOAuthState({ step: 'awaiting_user', deviceCode });
		} catch (err) {
			setOAuthState({
				step: 'error',
				message: err instanceof Error ? err.message : 'Failed to start OAuth',
			});
		}
	}, []);

	const startPolling = useCallback(
		(deviceCode: string, interval: number) => {
			stopPolling();
			setOAuthState({ step: 'polling' });

			pollingRef.current = setInterval(
				async () => {
					try {
						const response = await pollGitHubDeviceFlow({
							body: { sessionId: deviceCode },
						});
						if (response.error || !response.data) {
							throw new Error(errorMessage(response.error, 'Polling failed'));
						}
						const result = response.data;

						if (result.status === 'complete' && result.user) {
							stopPolling();
							setUser(toUser(result.user));
							setOAuthState({ step: 'complete' });
							setError(null);
						} else if (result.status === 'error') {
							stopPolling();
							setOAuthState({
								step: 'error',
								message: result.error || 'OAuth failed',
							});
						}
					} catch (err) {
						stopPolling();
						setOAuthState({
							step: 'error',
							message: err instanceof Error ? err.message : 'Polling failed',
						});
					}
				},
				(interval + 1) * 1000,
			);
		},
		[stopPolling],
	);

	const cancelOAuth = useCallback(() => {
		stopPolling();
		setOAuthState({ step: 'idle' });
	}, [stopPolling]);

	const logout = useCallback(async () => {
		try {
			const response = await disconnectGitHub();
			if (response.error)
				throw new Error(
					errorMessage(response.error, 'Failed to disconnect GitHub'),
				);
			setUser(null);
			setRepos([]);
			setOAuthState({ step: 'idle' });
		} catch (err) {
			console.error('Failed to logout:', err);
		}
	}, []);

	const loadRepos = useCallback(
		async (page?: number, search?: string) => {
			if (!user) return;
			try {
				setLoading(true);
				const response = await listGitHubRepositories({
					query: { page, search },
				});
				if (response.error || !response.data) {
					throw new Error(errorMessage(response.error, 'Failed to load repos'));
				}
				const repoList = response.data.repos.map(toRepo);
				if (page && page > 1) {
					setRepos((prev) => [...prev, ...repoList]);
				} else {
					setRepos(repoList);
				}
				return repoList;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to load repos');
				return [];
			} finally {
				setLoading(false);
			}
		},
		[user],
	);

	const cloneRepo = useCallback(
		async (url: string, path: string): Promise<string> => {
			if (!user) throw new Error('Not authenticated');
			const response = await cloneGitHubRepository({ body: { url, path } });
			if (response.error || !response.data) {
				throw new Error(errorMessage(response.error, 'Clone failed'));
			}
			return response.data.path;
		},
		[user],
	);

	return {
		user,
		repos,
		loading,
		error,
		isAuthenticated: !!user,
		oauthState,
		startOAuth,
		startPolling,
		cancelOAuth,
		logout,
		loadRepos,
		cloneRepo,
	};
}
