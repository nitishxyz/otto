import type { NewSessionRequest } from '@agentclientprotocol/sdk';
import type { MCPServerConfig } from '@ottocode/sdk';

export function acpMcpServersToOttoConfig(
	servers: NonNullable<NewSessionRequest['mcpServers']>,
): MCPServerConfig[] {
	return servers.flatMap((server): MCPServerConfig[] => {
		if ('type' in server && (server.type === 'http' || server.type === 'sse')) {
			return [
				{
					name: server.name,
					transport: server.type,
					url: server.url,
					headers: Object.fromEntries(
						server.headers.map((header) => [header.name, header.value]),
					),
					scope: 'project',
				},
			];
		}

		if ('command' in server) {
			return [
				{
					name: server.name,
					transport: 'stdio',
					command: server.command,
					args: server.args,
					env: Object.fromEntries(
						server.env.map((env) => [env.name, env.value]),
					),
					scope: 'project',
				},
			];
		}

		// ACP-transport MCP servers are not supported by otto yet.
		return [];
	});
}
