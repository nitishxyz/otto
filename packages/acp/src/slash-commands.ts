import type {
	AgentSideConnection,
	PromptResponse,
} from '@agentclientprotocol/sdk';
import { shareSession } from '@ottocode/server/runtime/share/service';
import {
	getGlobalConfigDir,
	getMCPManager,
	initializeMCP,
	loadConfig,
	loadMCPConfig,
	setConfig,
	type MCPServerConfig,
	type ReasoningLevel,
} from '@ottocode/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandArgs } from './commands';
import { acpMcpServersToOttoConfig } from './mcp';
import type { AcpSession } from './types';

const execFileAsync = promisify(execFile);

export async function handleShareCommand(
	client: AgentSideConnection,
	acpSessionId: string,
	session: AcpSession,
): Promise<PromptResponse> {
	if (!session.ottoSessionId) {
		await sendAgentText(
			client,
			acpSessionId,
			'Cannot share this session yet because it has not been persisted.',
		);
		return { stopReason: 'end_turn' };
	}

	try {
		const result = await shareSession({
			sessionId: session.ottoSessionId,
			projectRoot: session.cwd,
		});
		await sendAgentText(
			client,
			acpSessionId,
			`${result.message ?? 'Shared session'}: ${result.url}`,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await sendAgentText(
			client,
			acpSessionId,
			`Failed to share session: ${message}`,
		);
	}

	return { stopReason: 'end_turn' };
}

export async function handleReasoningCommand(
	client: AgentSideConnection,
	acpSessionId: string,
	session: AcpSession,
	command: string,
): Promise<PromptResponse> {
	try {
		const parts = splitCommandArgs(command);
		const action = parts[1]?.toLowerCase();
		const value = parts[2]?.toLowerCase();

		if (action && action !== 'status') {
			const updates = parseReasoningUpdates(action, value);
			if (!updates) {
				await sendAgentText(
					client,
					acpSessionId,
					'Reasoning usage:\n- /reasoning\n- /reasoning on\n- /reasoning off\n- /reasoning set <minimal|low|medium|high|max|xhigh>',
				);
				return { stopReason: 'end_turn' };
			}

			await setConfig('local', updates, session.cwd);
		}

		const cfg = await loadConfig(session.cwd);
		const enabled = cfg.defaults.reasoningText ?? false;
		const effort = cfg.defaults.reasoningLevel ?? 'high';
		const heading =
			action && action !== 'status'
				? 'Updated reasoning settings:'
				: 'Reasoning settings:';
		await sendAgentText(
			client,
			acpSessionId,
			[
				heading,
				`- Reasoning: ${enabled ? 'enabled' : 'disabled'}`,
				`- Effort: ${effort}`,
				`- Model: ${session.provider ?? cfg.defaults.provider}:${session.model ?? cfg.defaults.model}`,
			].join('\n'),
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await sendAgentText(
			client,
			acpSessionId,
			`Failed to read reasoning settings: ${message}`,
		);
	}

	return { stopReason: 'end_turn' };
}

const REASONING_LEVELS = new Set<ReasoningLevel>([
	'minimal',
	'low',
	'medium',
	'high',
	'max',
	'xhigh',
]);

function parseReasoningUpdates(
	action: string,
	value: string | undefined,
): Partial<{ reasoningText: boolean; reasoningLevel: ReasoningLevel }> | null {
	if (action === 'on' || action === 'enable' || action === 'enabled') {
		return { reasoningText: true };
	}
	if (action === 'off' || action === 'disable' || action === 'disabled') {
		return { reasoningText: false };
	}
	const level = action === 'set' || action === 'effort' ? value : action;
	if (level && REASONING_LEVELS.has(level as ReasoningLevel)) {
		return { reasoningText: true, reasoningLevel: level as ReasoningLevel };
	}
	return null;
}

export async function handleStageCommand(
	client: AgentSideConnection,
	acpSessionId: string,
	session: AcpSession,
	command: string,
): Promise<PromptResponse> {
	const files = splitCommandArgs(command).slice(1);
	const targets = files.length > 0 ? files : ['.'];

	try {
		await execFileAsync('git', ['add', '--', ...targets], {
			cwd: session.cwd,
		});
		const stagedLabel =
			targets.length === 1 && targets[0] === '.'
				? 'all changes'
				: targets.join(', ');
		await sendAgentText(client, acpSessionId, `Staged ${stagedLabel}.`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await sendAgentText(
			client,
			acpSessionId,
			`Failed to stage changes: ${message}`,
		);
	}

	return { stopReason: 'end_turn' };
}

export async function handleMcpCommand(
	client: AgentSideConnection,
	acpSessionId: string,
	session: AcpSession,
	command: string,
): Promise<PromptResponse> {
	const parts = command.split(/\s+/).filter(Boolean);
	const action = parts[1] ?? 'list';
	const name = parts[2];

	try {
		switch (action) {
			case 'list':
			case 'status': {
				const message = await formatMcpStatus(session);
				await sendAgentText(client, acpSessionId, message);
				break;
			}

			case 'start': {
				if (!name) {
					await sendAgentText(
						client,
						acpSessionId,
						'Usage: /mcp start <server-name>',
					);
					break;
				}
				const server = await findMcpServer(session, name);
				if (!server) {
					await sendAgentText(
						client,
						acpSessionId,
						`MCP server "${name}" is not configured.`,
					);
					break;
				}
				const manager = await getOrCreateMcpManager(session.cwd);
				await manager.restartServer(server);
				const status = (await manager.getStatusAsync()).find(
					(item) => item.name === server.name,
				);
				const authUrl = manager.getAuthUrl(server.name);
				await sendAgentText(
					client,
					acpSessionId,
					status?.connected
						? `Started MCP server "${server.name}" with ${status.tools.length} tool${status.tools.length === 1 ? '' : 's'}.`
						: authUrl
							? `MCP server "${server.name}" requires authentication: ${authUrl}`
							: `Started MCP server "${server.name}", but it is not connected yet. Check /mcp status.`,
				);
				break;
			}

			case 'stop': {
				if (!name) {
					await sendAgentText(
						client,
						acpSessionId,
						'Usage: /mcp stop <server-name>',
					);
					break;
				}
				const manager = getMCPManager(session.cwd);
				if (!manager) {
					await sendAgentText(
						client,
						acpSessionId,
						'No MCP servers are running.',
					);
					break;
				}
				await manager.stopServer(name);
				await sendAgentText(
					client,
					acpSessionId,
					`Stopped MCP server "${name}".`,
				);
				break;
			}

			case 'help': {
				await sendAgentText(
					client,
					acpSessionId,
					'MCP commands:\n- /mcp list\n- /mcp status\n- /mcp start <server-name>\n- /mcp stop <server-name>',
				);
				break;
			}

			default: {
				await sendAgentText(
					client,
					acpSessionId,
					`Unknown MCP command "${action}". Try /mcp help.`,
				);
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await sendAgentText(client, acpSessionId, `MCP command failed: ${message}`);
	}

	return { stopReason: 'end_turn' };
}

async function formatMcpStatus(session: AcpSession): Promise<string> {
	const configured = await getMcpServerConfigs(session);
	const manager = getMCPManager(session.cwd);
	const statuses = manager ? await manager.getStatusAsync() : [];

	if (configured.length === 0 && statuses.length === 0) {
		return 'No MCP servers configured. Add servers in otto config or through your ACP client.';
	}

	const lines = ['MCP servers:'];
	for (const server of configured) {
		const status = statuses.find((item) => item.name === server.name);
		const connected = status?.connected ? 'started' : 'stopped';
		const transport = server.transport ?? 'stdio';
		const toolCount = status?.tools.length ?? 0;
		lines.push(
			`- ${server.name} (${transport}): ${connected}${toolCount > 0 ? `, ${toolCount} tool${toolCount === 1 ? '' : 's'}` : ''}`,
		);
	}

	for (const status of statuses) {
		if (configured.some((server) => server.name === status.name)) continue;
		lines.push(
			`- ${status.name} (${status.transport ?? 'stdio'}): ${status.connected ? 'started' : 'stopped'}, ${status.tools.length} tool${status.tools.length === 1 ? '' : 's'}`,
		);
	}

	lines.push('', 'Use /mcp start <name> or /mcp stop <name>.');
	return lines.join('\n');
}

async function findMcpServer(
	session: AcpSession,
	name: string,
): Promise<MCPServerConfig | undefined> {
	const configs = await getMcpServerConfigs(session);
	return configs.find((server) => server.name === name);
}

async function getMcpServerConfigs(
	session: AcpSession,
): Promise<MCPServerConfig[]> {
	const config = await loadMCPConfig(session.cwd, getGlobalConfigDir());
	const servers = new Map<string, MCPServerConfig>();
	for (const server of config.servers) {
		servers.set(server.name, server);
	}
	for (const server of acpMcpServersToOttoConfig(session.mcpServers ?? [])) {
		servers.set(server.name, server);
	}
	return Array.from(servers.values());
}

async function getOrCreateMcpManager(cwd: string) {
	let manager = getMCPManager(cwd);
	if (!manager) {
		manager = await initializeMCP({ servers: [] }, cwd);
	}
	manager.setProjectRoot(cwd);
	return manager;
}

async function sendAgentText(
	client: AgentSideConnection,
	sessionId: string,
	text: string,
): Promise<void> {
	await client.sessionUpdate({
		sessionId,
		update: {
			sessionUpdate: 'agent_message_chunk',
			content: { type: 'text', text },
		},
	});
}
