import {
	addMCPServerToConfig,
	getGlobalConfigDir,
	getGlobalConfigPath,
	getMCPManager,
	getProjectConfigPath,
	initializeMCP,
	loadMCPConfig,
	logger,
	removeMCPServerFromConfig,
	type MCPServerConfig,
	type MCPServerStatus,
	type MCPScope,
	type MCPTransport,
} from '@ottocode/sdk';
import type { ForgeInput, ForgeScope } from './types.ts';
import {
	completeMCPAuth,
	getMCPAuthStatus,
	initiateMCPAuth,
} from '../../routes/mcp/service.ts';
import {
	copilotMCPOAuthStore,
	copilotMCPSessions,
} from '../../routes/mcp/state.ts';
import { reconcileMCPServerManagers } from '../../routes/mcp/service/reconcile.ts';

type MCPAction =
	| 'create'
	| 'update'
	| 'remove'
	| 'enable'
	| 'disable'
	| 'status'
	| 'authenticate'
	| 'reauthenticate'
	| 'logout'
	| 'execute';

function scheduleCopilotAuthPolling(
	projectRoot: string,
	name: string,
	sessionId: string,
	intervalSeconds: number,
): void {
	let attempts = 0;
	const run = async () => {
		try {
			attempts += 1;
			const result = await completeMCPAuth({
				name,
				projectRoot,
				oAuthStore: copilotMCPOAuthStore,
				sessions: copilotMCPSessions,
				body: { sessionId },
			});
			if (result.body.status === 'pending' && attempts < 60) {
				setTimeout(() => void run(), Math.max(intervalSeconds, 1) * 1000);
			}
		} catch (error) {
			logger.error(`MCP OAuth polling failed for '${name}'`, error);
		}
	};
	setTimeout(() => void run(), Math.max(intervalSeconds, 1) * 1000);
}

function summarizeServer(
	server: MCPServerConfig,
	status?: MCPServerStatus,
	authUrl?: string | null,
) {
	return {
		name: server.name,
		transport: server.transport ?? 'stdio',
		scope: server.scope ?? 'global',
		disabled: server.disabled ?? false,
		...(server.command ? { command: server.command } : {}),
		...(server.args?.length ? { args: server.args } : {}),
		...(server.url ? { url: server.url } : {}),
		connected: status?.connected ?? false,
		tools: status?.tools ?? [],
		...(status?.error ? { error: status.error } : {}),
		...(status?.authRequired ? { authRequired: true } : {}),
		...(status?.authRequired || authUrl
			? { authenticated: status?.authenticated ?? false }
			: {}),
		...(authUrl ? { authUrl } : {}),
	};
}

async function getStatuses(projectRoot: string): Promise<MCPServerStatus[]> {
	const manager = getMCPManager(projectRoot);
	if (!manager) return [];
	try {
		return await manager.getStatusAsync();
	} catch {
		return [];
	}
}

function getPendingAuthUrl(projectRoot: string, name: string): string | null {
	return getMCPManager(projectRoot)?.getAuthUrl(name) ?? null;
}

async function startServer(
	projectRoot: string,
	server: MCPServerConfig,
): Promise<MCPServerStatus | undefined> {
	let manager = getMCPManager(projectRoot);
	if (!manager) manager = await initializeMCP({ servers: [] }, projectRoot);
	if (!manager.started) manager.setProjectRoot(projectRoot);
	await manager.restartServer(server);
	return (await manager.getStatusAsync()).find(
		(status) => status.name === server.name,
	);
}

async function stopServer(projectRoot: string, name: string): Promise<void> {
	await getMCPManager(projectRoot)?.stopServer(name);
}

function getMCPConfigPath(projectRoot: string, scope: ForgeScope): string {
	return scope === 'project'
		? getProjectConfigPath(projectRoot)
		: getGlobalConfigPath();
}

function validateServerInput(
	input: ForgeInput,
	name: string,
	existing?: MCPServerConfig,
): MCPServerConfig {
	const transport: MCPTransport =
		input.transport ?? existing?.transport ?? 'stdio';
	const command = input.command ?? existing?.command;
	const url = input.url ?? existing?.url;

	if (transport === 'stdio' && !command) {
		throw new Error('command is required for stdio transport');
	}
	if (transport === 'stdio' && command && /^https?:\/\//i.test(command)) {
		throw new Error(
			'stdio transport requires a local command, not a URL; use http or sse',
		);
	}
	if ((transport === 'http' || transport === 'sse') && !url) {
		throw new Error('url is required for http/sse transport');
	}

	const scope: MCPScope = input.scope ?? existing?.scope ?? 'project';
	const args = input.args ?? existing?.args;
	const env = input.env ?? existing?.env;
	const headers = input.headers ?? existing?.headers;
	return {
		name,
		transport,
		scope,
		...(command ? { command } : {}),
		...(args?.length ? { args } : {}),
		...(env && Object.keys(env).length ? { env } : {}),
		...(url ? { url } : {}),
		...(headers && Object.keys(headers).length ? { headers } : {}),
		...(existing?.oauth ? { oauth: existing.oauth } : {}),
		...(existing?.cwd ? { cwd: existing.cwd } : {}),
		...(existing?.disabled ? { disabled: existing.disabled } : {}),
	};
}

export async function listForgeMCPServers(projectRoot: string) {
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const statuses = await getStatuses(projectRoot);
	return config.servers.map((server) =>
		summarizeServer(
			server,
			statuses.find((status) => status.name === server.name),
			getPendingAuthUrl(projectRoot, server.name),
		),
	);
}

export async function runForgeMCPAction(
	projectRoot: string,
	input: ForgeInput,
) {
	const action = input.action as MCPAction;
	const name = input.name?.trim();
	if (!name) throw new Error('name is required for mcp-server actions');

	const globalConfigDir = getGlobalConfigDir();
	const config = await loadMCPConfig(projectRoot, globalConfigDir);
	const existing = config.servers.find((server) => server.name === name);

	if (action === 'status') {
		if (!existing) throw new Error(`MCP server '${name}' not found`);
		return {
			ok: true,
			name,
			auth: await getMCPAuthStatus({
				name,
				projectRoot,
				oAuthStore: copilotMCPOAuthStore,
			}),
		};
	}

	if (action === 'create' || action === 'update') {
		if (action === 'create' && existing) {
			throw new Error(`MCP server '${name}' already exists; use update`);
		}
		if (action === 'update' && !existing) {
			throw new Error(`MCP server '${name}' not found`);
		}
		const server = validateServerInput(input, name, existing);
		const plan = {
			action,
			target: {
				kind: 'mcp-server' as const,
				scope: server.scope as ForgeScope,
				name,
				paths: [getMCPConfigPath(projectRoot, server.scope as ForgeScope)],
			},
			exists: Boolean(existing),
			changes: [
				`${action === 'create' ? 'Add' : 'Update'} MCP server '${name}' in ${server.scope} config`,
			],
			preview: JSON.stringify(server, null, 2),
		};
		if (input.dryRun) return { ok: true, applied: false, plan };

		if (existing && existing.scope !== server.scope) {
			const previousScope = existing.scope ?? 'global';
			await removeMCPServerFromConfig(
				projectRoot,
				name,
				globalConfigDir,
				previousScope,
			);
			await reconcileMCPServerManagers(projectRoot, previousScope, name);
		}
		await addMCPServerToConfig(projectRoot, server, globalConfigDir);
		await reconcileMCPServerManagers(
			projectRoot,
			server.scope ?? 'project',
			name,
		);
		if (!input.start) {
			return {
				ok: true,
				applied: true,
				plan,
				server: summarizeServer(server),
			};
		}
		try {
			const status = await startServer(projectRoot, server);
			return {
				ok: true,
				applied: true,
				plan,
				server: summarizeServer(
					server,
					status,
					getPendingAuthUrl(projectRoot, name),
				),
			};
		} catch (error) {
			return {
				ok: true,
				applied: true,
				plan,
				server: summarizeServer(server),
				startError: error instanceof Error ? error.message : String(error),
			};
		}
	}

	if (!existing) throw new Error(`MCP server '${name}' not found`);
	const scope = (existing.scope ?? 'global') as ForgeScope;
	const plan = {
		action,
		target: {
			kind: 'mcp-server' as const,
			scope,
			name,
			paths: [getMCPConfigPath(projectRoot, scope)],
		},
		exists: true,
		changes: [`${action} MCP server '${name}'`],
	};
	if (input.dryRun) return { ok: true, applied: false, plan };

	if (action === 'authenticate' || action === 'reauthenticate') {
		if (action === 'reauthenticate') {
			let manager = getMCPManager(projectRoot);
			if (!manager) manager = await initializeMCP({ servers: [] }, projectRoot);
			await manager.clearAuthData(
				name,
				existing.scope ?? 'global',
				projectRoot,
			);
			await manager.stopServer(name);
		}
		const result = await initiateMCPAuth({
			name,
			projectRoot,
			oAuthStore: copilotMCPOAuthStore,
			sessions: copilotMCPSessions,
		});
		if (!result.ok) throw new Error(result.body.error);
		if (
			result.body.authType === 'copilot-device' &&
			result.body.sessionId &&
			result.body.interval
		) {
			scheduleCopilotAuthPolling(
				projectRoot,
				name,
				result.body.sessionId,
				result.body.interval,
			);
		}
		return { ok: true, applied: true, plan, auth: result.body };
	}

	if (action === 'logout') {
		let manager = getMCPManager(projectRoot);
		if (!manager) manager = await initializeMCP({ servers: [] }, projectRoot);
		await manager.clearAuthData(name, existing.scope ?? 'global', projectRoot);
		await manager.stopServer(name);
		return { ok: true, applied: true, plan };
	}

	if (action === 'remove') {
		try {
			await stopServer(projectRoot, name);
		} catch {}
		const removed = await removeMCPServerFromConfig(
			projectRoot,
			name,
			globalConfigDir,
			existing.scope ?? 'global',
		);
		if (!removed) throw new Error(`MCP server '${name}' not found in config`);
		await reconcileMCPServerManagers(
			projectRoot,
			existing.scope ?? 'global',
			name,
		);
		return { ok: true, applied: true, plan };
	}

	if (action === 'disable') {
		const server = { ...existing, disabled: true };
		await addMCPServerToConfig(projectRoot, server, globalConfigDir);
		await reconcileMCPServerManagers(
			projectRoot,
			server.scope ?? 'global',
			name,
		);
		return { ok: true, applied: true, plan, server: summarizeServer(server) };
	}

	if (action === 'enable') {
		const server = { ...existing, disabled: false };
		await addMCPServerToConfig(projectRoot, server, globalConfigDir);
		await reconcileMCPServerManagers(
			projectRoot,
			server.scope ?? 'global',
			name,
		);
		try {
			const status = await startServer(projectRoot, server);
			return {
				ok: true,
				applied: true,
				plan,
				server: summarizeServer(
					server,
					status,
					getPendingAuthUrl(projectRoot, name),
				),
			};
		} catch (error) {
			return {
				ok: true,
				applied: true,
				plan,
				server: summarizeServer(server),
				startError: error instanceof Error ? error.message : String(error),
			};
		}
	}

	if (action === 'execute') {
		const operation = input.operation;
		if (!operation) {
			throw new Error('operation is required to execute an MCP server action');
		}
		if (operation === 'stop') {
			await stopServer(projectRoot, name);
			return { ok: true, applied: true, plan, operation };
		}
		if (existing.disabled) {
			throw new Error(`MCP server '${name}' is disabled; enable it first`);
		}
		const status = await startServer(projectRoot, existing);
		return {
			ok: true,
			applied: true,
			plan,
			operation,
			server: summarizeServer(
				existing,
				status,
				getPendingAuthUrl(projectRoot, name),
			),
		};
	}

	throw new Error(`Action '${action}' is not supported for mcp-server`);
}
