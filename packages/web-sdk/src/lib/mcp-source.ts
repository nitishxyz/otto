import type { MCPServerInfo } from '../stores/mcpStore';

/**
 * Concise source descriptor for an MCP server, suitable for a small badge.
 *
 * - User servers fall back to their scope, e.g. `project` or `global`.
 * - Plugin-provided servers read `plugin: <name>` from the backend `sourceLabel`.
 */
export function getMcpSourceLabel(
	server: Pick<MCPServerInfo, 'sourceLabel' | 'sourcePlugin' | 'scope'>,
): string {
	if (server.sourceLabel?.trim()) return server.sourceLabel.trim();
	if (server.sourcePlugin?.trim())
		return `plugin: ${server.sourcePlugin.trim()}`;
	return server.scope;
}

/** True when the server definition is provided by an enabled plugin. */
export function isPluginManagedMcpServer(
	server: Pick<MCPServerInfo, 'managedByPlugin' | 'sourceKind'>,
): boolean {
	return server.managedByPlugin === true || server.sourceKind === 'plugin';
}
