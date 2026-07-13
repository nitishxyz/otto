import {
	addMCPServerToConfig,
	formatMcpServerSourceLabel,
	getGlobalConfigDir,
	getMCPManager,
	isGitHubCopilotUrl,
	isPluginManagedMcpServer,
	loadMCPConfig,
	removeMCPServerFromConfig,
	type MCPServerConfig,
	type MCPTransport,
} from '@ottocode/sdk';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';

export async function listMCPServers(projectRoot: string) {
	const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
	const manager = getMCPManager(projectRoot);
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
			error: status?.error,
			authRequired: status?.authRequired ?? false,
			authenticated: status?.authenticated ?? false,
			scope: server.scope ?? 'global',
			sourceKind: server.source?.kind ?? 'user',
			sourcePlugin: server.source?.plugin,
			sourceLabel: formatMcpServerSourceLabel(server),
			managedByPlugin: isPluginManagedMcpServer(server),
			overridesPlugin: server.source?.overridesPlugin,
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

	const selectedTransport: MCPTransport =
		transport === 'http' || transport === 'sse' ? transport : 'stdio';
	if (selectedTransport === 'stdio' && !command) {
		return {
			ok: false as const,
			error: 'command is required for stdio transport',
			status: 400 as const,
		};
	}
	if (
		selectedTransport === 'stdio' &&
		command &&
		/^https?:\/\//i.test(String(command))
	) {
		return {
			ok: false as const,
			error:
				'stdio transport requires a local command, not a URL. Use http or sse transport for remote servers.',
			status: 400 as const,
		};
	}
	if (
		selectedTransport === 'stdio' &&
		Array.isArray(args) &&
		args.some((arg) => /^[\u2010-\u2015\u2212]/.test(String(arg)))
	) {
		return {
			ok: false as const,
			error:
				'Command arguments contain a Unicode dash. Use regular hyphens, for example "--yes" instead of "—yes".',
			status: 400 as const,
		};
	}
	if ((selectedTransport === 'http' || selectedTransport === 'sse') && !url) {
		return {
			ok: false as const,
			error: 'url is required for http/sse transport',
			status: 400 as const,
		};
	}

	const serverScope = scope === 'project' ? 'project' : 'global';
	const serverConfig: MCPServerConfig = {
		name: String(name),
		transport: selectedTransport,
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
	projectRoot: string,
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
	} catch (error) {
		return {
			ok: false as const,
			body: { ok: false, error: toErrorMessage(error) },
			status: 500 as const,
		};
	}
}

export async function removeMCPServer(name: string, projectRoot: string) {
	try {
		const manager = getMCPManager(projectRoot);
		if (manager) {
			const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
			const serverConfig = config.servers.find(
				(server) => server.name === name,
			);
			const scope = serverConfig?.scope ?? 'global';
			await manager.clearAuthData(name, scope, projectRoot);
			await manager.stopServer(name);
		}

		let removed = await removeMCPServerFromConfig(
			projectRoot,
			name,
			getGlobalConfigDir(),
		);
		if (!removed) {
			const config = await loadMCPConfig(projectRoot, getGlobalConfigDir());
			const server = config.servers.find((entry) => entry.name === name);
			if (server && isPluginManagedMcpServer(server)) {
				const { source: _source, ...serverWithoutSource } = server;
				await addMCPServerToConfig(
					projectRoot,
					{
						...serverWithoutSource,
						scope: 'project',
						disabled: true,
					},
					getGlobalConfigDir(),
				);
				removed = true;
			}
		}
		if (!removed) {
			return {
				ok: false as const,
				body: { ok: false, error: `Server "${name}" not found` },
				status: 404 as const,
			};
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
