import {
	COPILOT_MCP_SCOPE,
	authorizeCopilot,
	getCopilotMCPOAuthKey,
	getGlobalConfigDir,
	getMCPManager,
	getStoredCopilotMCPToken,
	initializeMCP,
	isGitHubCopilotUrl,
	loadMCPConfig,
	pollForCopilotTokenOnce,
} from '@ottocode/sdk';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import type { MCPAuthSessionOptions, MCPAuthStoreOptions } from './types.ts';

export async function initiateMCPAuth(options: MCPAuthSessionOptions) {
	const { name, oAuthStore, sessions } = options;
	const projectRoot = options.projectRoot ?? process.cwd();
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const serverConfig = config.servers.find((server) => server.name === name);

	if (!serverConfig) {
		return {
			ok: false as const,
			body: { ok: false, error: `Server "${name}" not found` },
			status: 404 as const,
		};
	}

	if (isGitHubCopilotUrl(serverConfig.url)) {
		try {
			const existingAuth = await getStoredCopilotMCPToken(
				oAuthStore,
				name,
				serverConfig.scope ?? 'global',
				projectRoot,
			);
			if (existingAuth.token && !existingAuth.needsReauth) {
				return {
					ok: true as const,
					body: {
						ok: true,
						name,
						authType: 'copilot-device',
						authenticated: true,
						message: 'Already authenticated with MCP scopes',
					},
				};
			}

			const deviceData = await authorizeCopilot({ mcp: true });
			const sessionId = crypto.randomUUID();
			sessions.set(sessionId, {
				deviceCode: deviceData.deviceCode,
				interval: deviceData.interval,
				serverName: name,
				createdAt: Date.now(),
			});
			return {
				ok: true as const,
				body: {
					ok: true,
					name,
					authType: 'copilot-device',
					sessionId,
					userCode: deviceData.userCode,
					verificationUri: deviceData.verificationUri,
					interval: deviceData.interval,
				},
			};
		} catch (error) {
			return {
				ok: false as const,
				body: { ok: false, error: toErrorMessage(error) },
				status: 500 as const,
			};
		}
	}

	try {
		let manager = getMCPManager();
		if (!manager) {
			manager = await initializeMCP({ servers: [] }, projectRoot);
		}
		if (!manager.started) {
			manager.setProjectRoot(projectRoot);
		}

		const authUrl = await manager.initiateAuth(serverConfig);
		if (authUrl) {
			return { ok: true as const, body: { ok: true, authUrl, name } };
		}
		return {
			ok: true as const,
			body: {
				ok: true,
				name,
				message: 'Already authenticated or no auth required',
			},
		};
	} catch (error) {
		return {
			ok: false as const,
			body: { ok: false, error: toErrorMessage(error) },
			status: 500 as const,
		};
	}
}

export async function completeMCPAuth(
	options: MCPAuthSessionOptions & {
		body: Record<string, unknown>;
	},
) {
	const { name, body, oAuthStore, sessions } = options;
	const { code, sessionId } = body;
	const projectRoot = options.projectRoot ?? process.cwd();

	if (typeof sessionId === 'string' && sessionId.length > 0) {
		const session = sessions.get(sessionId);
		if (!session || session.serverName !== name) {
			return {
				ok: false as const,
				body: { ok: false, error: 'Session expired or invalid' },
				status: 400 as const,
			};
		}
		try {
			const result = await pollForCopilotTokenOnce(session.deviceCode);
			if (result.status === 'complete') {
				sessions.delete(sessionId);
				const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
				const serverConfig = config.servers.find(
					(server) => server.name === name,
				);
				if (!serverConfig) {
					return {
						ok: false as const,
						body: { ok: false, error: `Server "${name}" not found` },
						status: 404 as const,
					};
				}
				await oAuthStore.saveTokens(
					getCopilotMCPOAuthKey(
						name,
						serverConfig.scope ?? 'global',
						projectRoot,
					),
					{
						access_token: result.accessToken,
						scope: COPILOT_MCP_SCOPE,
					},
				);
				let mcpManager = getMCPManager();
				if (!mcpManager) {
					mcpManager = await initializeMCP({ servers: [] }, projectRoot);
				}
				await mcpManager.restartServer(serverConfig);
				mcpManager = getMCPManager();
				const status = mcpManager
					? (await mcpManager.getStatusAsync()).find(
							(server) => server.name === name,
						)
					: undefined;
				return {
					ok: true as const,
					body: {
						ok: true,
						status: 'complete',
						name,
						connected: status?.connected ?? false,
						tools: status?.tools ?? [],
					},
				};
			}
			if (result.status === 'pending') {
				return { ok: true as const, body: { ok: true, status: 'pending' } };
			}
			sessions.delete(sessionId);
			return {
				ok: true as const,
				body: {
					ok: false,
					status: 'error',
					error: result.status === 'error' ? result.error : 'Unknown error',
				},
			};
		} catch (error) {
			return {
				ok: false as const,
				body: { ok: false, error: toErrorMessage(error) },
				status: 500 as const,
			};
		}
	}

	if (!code) {
		return {
			ok: false as const,
			body: { ok: false, error: 'code is required' },
			status: 400 as const,
		};
	}

	const manager = getMCPManager();
	if (!manager) {
		return {
			ok: false as const,
			body: { ok: false, error: 'No MCP manager active' },
			status: 400 as const,
		};
	}

	try {
		const success = await manager.completeAuth(name, String(code));
		if (success) {
			const status = (await manager.getStatusAsync()).find(
				(server) => server.name === name,
			);
			return {
				ok: true as const,
				body: {
					ok: true,
					name,
					connected: status?.connected ?? false,
					tools: status?.tools ?? [],
				},
			};
		}
		return {
			ok: false as const,
			body: { ok: false, error: 'Auth completion failed' },
			status: 500 as const,
		};
	} catch (error) {
		return {
			ok: false as const,
			body: { ok: false, error: toErrorMessage(error) },
			status: 500 as const,
		};
	}
}

export async function getMCPAuthStatus(options: MCPAuthStoreOptions) {
	const { name, oAuthStore } = options;
	const projectRoot = options.projectRoot ?? process.cwd();
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const serverConfig = config.servers.find((server) => server.name === name);

	if (serverConfig && isGitHubCopilotUrl(serverConfig.url)) {
		try {
			const auth = await getStoredCopilotMCPToken(
				oAuthStore,
				name,
				serverConfig.scope ?? 'global',
				projectRoot,
			);
			const authenticated = !!auth.token && !auth.needsReauth;
			return { authenticated, authType: 'copilot-device' };
		} catch {
			return { authenticated: false, authType: 'copilot-device' };
		}
	}

	const manager = getMCPManager();
	if (!manager) {
		return { authenticated: false };
	}

	try {
		return await manager.getAuthStatus(name);
	} catch {
		return { authenticated: false };
	}
}

export async function revokeMCPAuth(options: MCPAuthStoreOptions) {
	const { name, oAuthStore } = options;
	const projectRoot = options.projectRoot ?? process.cwd();
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const serverConfig = config.servers.find((server) => server.name === name);

	if (serverConfig && isGitHubCopilotUrl(serverConfig.url)) {
		try {
			const key = getCopilotMCPOAuthKey(
				name,
				serverConfig.scope ?? 'global',
				projectRoot,
			);
			await oAuthStore.clearServer(key);
			if (key !== name) {
				await oAuthStore.clearServer(name);
			}
			const manager = getMCPManager();
			if (manager) {
				await manager.clearAuthData(
					name,
					serverConfig.scope ?? 'global',
					projectRoot,
				);
				await manager.stopServer(name);
			}
			return { ok: true as const, body: { ok: true, name } };
		} catch (error) {
			return {
				ok: false as const,
				body: { ok: false, error: toErrorMessage(error) },
				status: 500 as const,
			};
		}
	}

	const manager = getMCPManager();
	if (!manager) {
		return {
			ok: false as const,
			body: { ok: false, error: 'No MCP manager active' },
			status: 400 as const,
		};
	}

	try {
		await manager.revokeAuth(name);
		return { ok: true as const, body: { ok: true, name } };
	} catch (error) {
		return {
			ok: false as const,
			body: { ok: false, error: toErrorMessage(error) },
			status: 500 as const,
		};
	}
}
