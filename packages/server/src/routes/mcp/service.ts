import {
	COPILOT_MCP_SCOPE,
	addMCPServerToConfig,
	authorizeCopilot,
	getCopilotMCPOAuthKey,
	getGlobalConfigDir,
	getMCPManager,
	getStoredCopilotMCPToken,
	initializeMCP,
	isGitHubCopilotUrl,
	loadMCPConfig,
	MCPClientWrapper,
	pollForCopilotTokenOnce,
	removeMCPServerFromConfig,
	type MCPServerConfig,
	type MCPTransport,
	type OAuthCredentialStore,
} from '@ottocode/sdk';

type CopilotMCPSession = {
	deviceCode: string;
	interval: number;
	serverName: string;
	createdAt: number;
};

export async function listMCPServers(projectRoot = process.cwd()) {
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const manager = getMCPManager();
	const statuses = manager ? await manager.getStatusAsync() : [];

	return config.servers.map((server) => {
		const status = statuses.find((item) => item.name === server.name);
		return {
			name: server.name,
			transport: server.transport ?? 'stdio',
			command: server.command,
			args: server.args ?? [],
			url: server.url,
			disabled: server.disabled ?? false,
			connected: status?.connected ?? false,
			tools: status?.tools ?? [],
			authRequired: status?.authRequired ?? false,
			authenticated: status?.authenticated ?? false,
			scope: server.scope ?? 'global',
			...(isGitHubCopilotUrl(server.url) ? { authType: 'copilot-device' } : {}),
		};
	});
}

export function buildMCPServerConfig(body: Record<string, unknown>) {
	const { name, transport, command, args, env, url, headers, oauth, scope } =
		body;
	if (!name) {
		return {
			ok: false as const,
			error: 'name is required',
			status: 400 as const,
		};
	}

	const t: MCPTransport =
		transport === 'http' || transport === 'sse' ? transport : 'stdio';
	if (t === 'stdio' && !command) {
		return {
			ok: false as const,
			error: 'command is required for stdio transport',
			status: 400 as const,
		};
	}
	if (t === 'stdio' && command && /^https?:\/\//i.test(String(command))) {
		return {
			ok: false as const,
			error:
				'stdio transport requires a local command, not a URL. Use http or sse transport for remote servers.',
			status: 400 as const,
		};
	}
	if ((t === 'http' || t === 'sse') && !url) {
		return {
			ok: false as const,
			error: 'url is required for http/sse transport',
			status: 400 as const,
		};
	}

	const serverScope = scope === 'project' ? 'project' : 'global';
	const serverConfig: MCPServerConfig = {
		name: String(name),
		transport: t,
		scope: serverScope,
		...(command ? { command: String(command) } : {}),
		...(Array.isArray(args) ? { args: args.map(String) } : {}),
		...(env && typeof env === 'object'
			? { env: env as Record<string, string> }
			: {}),
		...(url ? { url: String(url) } : {}),
		...(headers && typeof headers === 'object'
			? { headers: headers as Record<string, string> }
			: {}),
		...(oauth && typeof oauth === 'object'
			? { oauth: oauth as MCPServerConfig['oauth'] }
			: {}),
	};

	return {
		ok: true as const,
		serverConfig,
	};
}

export async function addMCPServer(
	body: Record<string, unknown>,
	projectRoot = process.cwd(),
) {
	const built = buildMCPServerConfig(body);
	if (!built.ok)
		return { ok: false as const, body: built, status: built.status };

	try {
		await addMCPServerToConfig(
			projectRoot,
			built.serverConfig,
			getGlobalConfigDir(),
		);
		return {
			ok: true as const,
			body: { ok: true, server: built.serverConfig },
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function removeMCPServer(
	name: string,
	projectRoot = process.cwd(),
) {
	try {
		const manager = getMCPManager();
		if (manager) {
			const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
			const serverConfig = config.servers.find(
				(server) => server.name === name,
			);
			const scope = serverConfig?.scope ?? 'global';
			await manager.clearAuthData(name, scope, projectRoot);
			await manager.stopServer(name);
		}

		const removed = await removeMCPServerFromConfig(
			projectRoot,
			name,
			getGlobalConfigDir(),
		);
		if (!removed) {
			return {
				ok: false as const,
				body: { ok: false, error: `Server "${name}" not found` },
				status: 404 as const,
			};
		}
		return { ok: true as const, body: { ok: true, name } };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function startMCPServer(options: {
	name: string;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
	sessions: Map<string, CopilotMCPSession>;
}) {
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

	try {
		let manager = getMCPManager();
		if (!manager) {
			manager = await initializeMCP({ servers: [] }, projectRoot);
		}
		if (!manager.started) {
			manager.setProjectRoot(projectRoot);
		}
		await manager.restartServer(serverConfig);
		const status = (await manager.getStatusAsync()).find(
			(server) => server.name === name,
		);

		if (isGitHubCopilotUrl(serverConfig.url) && !status?.connected) {
			const existingAuth = await getStoredCopilotMCPToken(
				oAuthStore,
				name,
				serverConfig.scope ?? 'global',
				projectRoot,
			);

			if (!existingAuth.token || existingAuth.needsReauth) {
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
						connected: false,
						authRequired: true,
						authType: 'copilot-device',
						sessionId,
						userCode: deviceData.userCode,
						verificationUri: deviceData.verificationUri,
						interval: deviceData.interval,
					},
				};
			}
		}

		return {
			ok: true as const,
			body: {
				ok: true,
				name,
				connected: status?.connected ?? false,
				tools: status?.tools ?? [],
				authRequired: status?.authRequired ?? false,
				authUrl: manager.getAuthUrl(name),
			},
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function stopMCPServer(name: string) {
	const manager = getMCPManager();
	if (!manager) {
		return {
			ok: false as const,
			body: { ok: false, error: 'No MCP manager active' },
			status: 400 as const,
		};
	}

	try {
		await manager.stopServer(name);
		return { ok: true as const, body: { ok: true, name, connected: false } };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function initiateMCPAuth(options: {
	name: string;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
	sessions: Map<string, CopilotMCPSession>;
}) {
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
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				ok: false as const,
				body: { ok: false, error: msg },
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
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function completeMCPAuth(options: {
	name: string;
	body: Record<string, unknown>;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
	sessions: Map<string, CopilotMCPSession>;
}) {
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
				let mcpMgr = getMCPManager();
				if (!mcpMgr) {
					mcpMgr = await initializeMCP({ servers: [] }, projectRoot);
				}
				await mcpMgr.restartServer(serverConfig);
				mcpMgr = getMCPManager();
				const status = mcpMgr
					? (await mcpMgr.getStatusAsync()).find(
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
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				ok: false as const,
				body: { ok: false, error: msg },
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
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function getMCPAuthStatus(options: {
	name: string;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
}) {
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

export async function revokeMCPAuth(options: {
	name: string;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
}) {
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
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				ok: false as const,
				body: { ok: false, error: msg },
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
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}

export async function testMCPServer(name: string, projectRoot = process.cwd()) {
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const serverConfig = config.servers.find((server) => server.name === name);

	if (!serverConfig) {
		return {
			ok: false as const,
			body: { ok: false, error: `Server "${name}" not found` },
			status: 404 as const,
		};
	}

	const client = new MCPClientWrapper(serverConfig);
	try {
		await client.connect();
		const tools = await client.listTools();
		await client.disconnect();
		return {
			ok: true as const,
			body: {
				ok: true,
				name,
				tools: tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
				})),
			},
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false as const,
			body: { ok: false, error: msg },
			status: 500 as const,
		};
	}
}
