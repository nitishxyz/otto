import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { getGlobalConfigDir } from '../../../../config/src/paths.ts';
import {
	addMCPServerToConfig,
	getMCPManager,
	initializeMCP,
	loadMCPConfig,
	removeMCPServerFromConfig,
} from '../../mcp/lifecycle.ts';
import type {
	MCPScope,
	MCPServerConfig,
	MCPServerStatus,
	MCPTransport,
} from '../../mcp/types.ts';
import { createToolError } from '../error.ts';

const mcpActions = [
	'list',
	'add',
	'update',
	'remove',
	'enable',
	'disable',
] as const;

type MCPManagerAction = (typeof mcpActions)[number];

type ServerSummary = {
	name: string;
	transport: MCPTransport;
	scope: MCPScope;
	disabled: boolean;
	command?: string;
	args?: string[];
	url?: string;
	connected: boolean;
	tools: string[];
	error?: string;
	authRequired?: boolean;
	authenticated?: boolean;
	authUrl?: string;
};

function summarizeServer(
	server: MCPServerConfig,
	status?: MCPServerStatus,
	authUrl?: string | null,
): ServerSummary {
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

function getPendingAuthUrl(projectRoot: string, name: string): string | null {
	return getMCPManager(projectRoot)?.getAuthUrl(name) ?? null;
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

async function startServer(
	projectRoot: string,
	server: MCPServerConfig,
): Promise<MCPServerStatus | undefined> {
	let manager = getMCPManager(projectRoot);
	if (!manager) {
		manager = await initializeMCP({ servers: [] }, projectRoot);
	}
	if (!manager.started) {
		manager.setProjectRoot(projectRoot);
	}
	await manager.restartServer(server);
	const statuses = await manager.getStatusAsync();
	return statuses.find((status) => status.name === server.name);
}

async function stopServer(projectRoot: string, name: string): Promise<void> {
	const manager = getMCPManager(projectRoot);
	if (!manager) return;
	await manager.stopServer(name);
}

type MCPManagerInput = {
	action: MCPManagerAction;
	name?: string;
	scope?: MCPScope;
	transport?: MCPTransport;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	start?: boolean;
};

function validateServerInput(
	input: MCPManagerInput,
	existing?: MCPServerConfig,
):
	| { ok: true; server: MCPServerConfig }
	| { ok: false; error: ReturnType<typeof createToolError> } {
	const name = input.name?.trim();
	if (!name) {
		return {
			ok: false,
			error: createToolError('name is required', 'validation', {
				parameter: 'name',
			}),
		};
	}

	const transport: MCPTransport =
		input.transport ?? existing?.transport ?? 'stdio';
	const command = input.command ?? existing?.command;
	const url = input.url ?? existing?.url;

	if (transport === 'stdio' && !command) {
		return {
			ok: false,
			error: createToolError(
				'command is required for stdio transport',
				'validation',
				{ parameter: 'command' },
			),
		};
	}
	if (transport === 'stdio' && command && /^https?:\/\//i.test(command)) {
		return {
			ok: false,
			error: createToolError(
				'stdio transport requires a local command, not a URL. Use http or sse transport for remote servers.',
				'validation',
				{ parameter: 'command', value: command },
			),
		};
	}
	if ((transport === 'http' || transport === 'sse') && !url) {
		return {
			ok: false,
			error: createToolError(
				'url is required for http/sse transport',
				'validation',
				{ parameter: 'url' },
			),
		};
	}

	const scope: MCPScope =
		input.scope ?? existing?.scope ?? ('global' as MCPScope);
	const args = input.args ?? existing?.args;
	const env = input.env ?? existing?.env;
	const headers = input.headers ?? existing?.headers;

	const server: MCPServerConfig = {
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

	return { ok: true, server };
}

/**
 * Build the `mcp_manager` lazy tool which lets an agent list, add, update,
 * remove, enable, or disable MCP servers in the otto project (.otto/config.json)
 * or global (~/.config/otto/config.json) configuration.
 */
export function buildMCPManagerTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'mcp_manager',
		tool: tool({
			description: `Manage otto MCP (Model Context Protocol) servers.

Actions:
- list: list configured MCP servers with scope, disabled flag, and connection status
- add: add a new MCP server (upserts if the name already exists)
- update: update an existing MCP server; omitted fields keep their current values
- remove: stop and delete an MCP server from config
- enable: clear the disabled flag and start the server
- disable: set the disabled flag and stop the server

Scope:
- "project" writes to <project>/.otto/config.json (shared with the repo)
- "global" writes to the user's global otto config (default)

Transports:
- stdio requires "command" (plus optional "args"/"env")
- http/sse require "url" (plus optional "headers")

Set "start": true on add/update to start the server immediately. Tools from servers started via start/enable become available to you directly on your next step in the current turn; other configured servers expose their tools via load_mcp_tools.

Authentication: some http/sse servers require OAuth. When a started server needs auth, the result includes "authRequired": true and (when available) an "authUrl". Share the authUrl with the user as a clickable link and ask them to open it in their browser to authorize; the server reconnects automatically once auth completes. Use action "list" afterwards to confirm it is connected.`,
			inputSchema: z.object({
				action: z.enum(mcpActions).describe('Operation to perform.'),
				name: z
					.string()
					.optional()
					.describe('MCP server name (required for all actions except list).'),
				scope: z
					.enum(['global', 'project'])
					.optional()
					.describe(
						'Config scope: "project" (.otto/config.json) or "global" (default for new servers).',
					),
				transport: z
					.enum(['stdio', 'http', 'sse'])
					.optional()
					.describe('Transport type (default stdio).'),
				command: z
					.string()
					.optional()
					.describe('Executable for stdio transport (e.g. "bunx").'),
				args: z
					.array(z.string())
					.optional()
					.describe('Arguments for the stdio command.'),
				env: z
					.record(z.string())
					.optional()
					.describe('Environment variables for the stdio command.'),
				url: z
					.string()
					.optional()
					.describe('Server URL for http/sse transport.'),
				headers: z
					.record(z.string())
					.optional()
					.describe('HTTP headers for http/sse transport.'),
				start: z
					.boolean()
					.optional()
					.describe('Start the server immediately after add/update.'),
			}),
			execute: async (input: MCPManagerInput) => {
				const globalConfigDir = getGlobalConfigDir();
				const action = input.action;

				if (action === 'list') {
					const config = await loadMCPConfig(projectRoot, globalConfigDir);
					const statuses = await getStatuses(projectRoot);
					return {
						ok: true,
						servers: config.servers.map((server) =>
							summarizeServer(
								server,
								statuses.find((status) => status.name === server.name),
								getPendingAuthUrl(projectRoot, server.name),
							),
						),
					};
				}

				const name = input.name?.trim();
				if (!name) {
					return createToolError(
						`name is required for action "${action}"`,
						'validation',
						{ parameter: 'name' },
					);
				}

				const config = await loadMCPConfig(projectRoot, globalConfigDir);
				const existing = config.servers.find((server) => server.name === name);

				if (action === 'add' || action === 'update') {
					if (action === 'update' && !existing) {
						return createToolError(
							`MCP server "${name}" not found`,
							'not_found',
							{ parameter: 'name', value: name },
						);
					}
					const validated = validateServerInput(input, existing);
					if (!validated.ok) return validated.error;
					const server = validated.server;

					if (existing && existing.scope !== server.scope) {
						await removeMCPServerFromConfig(projectRoot, name, globalConfigDir);
					}
					await addMCPServerToConfig(projectRoot, server, globalConfigDir);

					if (input.start) {
						try {
							const status = await startServer(projectRoot, server);
							return {
								ok: true,
								action,
								server: summarizeServer(
									server,
									status,
									getPendingAuthUrl(projectRoot, server.name),
								),
							};
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							return {
								ok: true,
								action,
								server: summarizeServer(server),
								startError: msg,
							};
						}
					}
					return { ok: true, action, server: summarizeServer(server) };
				}

				if (!existing) {
					return createToolError(
						`MCP server "${name}" not found`,
						'not_found',
						{ parameter: 'name', value: name },
					);
				}

				if (action === 'remove') {
					try {
						await stopServer(projectRoot, name);
					} catch {}
					const removed = await removeMCPServerFromConfig(
						projectRoot,
						name,
						globalConfigDir,
					);
					if (!removed) {
						return createToolError(
							`MCP server "${name}" not found in any config file`,
							'not_found',
							{ parameter: 'name', value: name },
						);
					}
					return { ok: true, action, name };
				}

				if (action === 'enable') {
					const server: MCPServerConfig = { ...existing, disabled: false };
					await addMCPServerToConfig(projectRoot, server, globalConfigDir);
					try {
						const status = await startServer(projectRoot, server);
						return {
							ok: true,
							action,
							server: summarizeServer(
								server,
								status,
								getPendingAuthUrl(projectRoot, server.name),
							),
						};
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						return {
							ok: true,
							action,
							server: summarizeServer(server),
							startError: msg,
						};
					}
				}

				if (action === 'disable') {
					const server: MCPServerConfig = { ...existing, disabled: true };
					await addMCPServerToConfig(projectRoot, server, globalConfigDir);
					try {
						await stopServer(projectRoot, name);
					} catch {}
					return { ok: true, action, server: summarizeServer(server) };
				}

				return createToolError(`Unknown action "${action}"`, 'validation', {
					parameter: 'action',
					value: action,
				});
			},
		}),
	};
}
