import {
	authorizeCopilot,
	getGlobalConfigDir,
	getMCPManager,
	getStoredCopilotMCPToken,
	initializeMCP,
	isGitHubCopilotUrl,
	loadMCPConfig,
	MCPClientWrapper,
} from '@ottocode/sdk';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import { createMCPAuthFlow } from '../oauth-flows.ts';
import type { MCPAuthSessionOptions } from './types.ts';

export async function startMCPServer(options: MCPAuthSessionOptions) {
	const { name, oAuthStore, sessions } = options;
	const { projectRoot } = options;
	if (!projectRoot) {
		return {
			ok: false as const,
			body: { ok: false, error: 'Project root is required' },
			status: 400 as const,
		};
	}
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
		let manager = getMCPManager(projectRoot);
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
					projectRoot,
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

		const authUrl = manager.getAuthUrl(name);
		const callbackUrl = authUrl ? manager.getAuthCallbackUrl(name) : null;
		const flow =
			authUrl && callbackUrl
				? createMCPAuthFlow({
						name,
						projectRoot,
						authUrl,
						callbackUrl,
					})
				: undefined;
		return {
			ok: true as const,
			body: {
				ok: true,
				name,
				connected: status?.connected ?? false,
				tools: status?.tools ?? [],
				authRequired: status?.authRequired ?? false,
				authUrl: authUrl ?? undefined,
				...flow,
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

export async function stopMCPServer(name: string, projectRoot: string) {
	const manager = getMCPManager(projectRoot);
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
	} catch (error) {
		return {
			ok: false as const,
			body: { ok: false, error: toErrorMessage(error) },
			status: 500 as const,
		};
	}
}

export async function testMCPServer(name: string, projectRoot: string) {
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
	} catch (error) {
		return {
			ok: false as const,
			body: { ok: false, error: toErrorMessage(error) },
			status: 500 as const,
		};
	}
}
