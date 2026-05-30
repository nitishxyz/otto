import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import type { MCPServerManager } from './server-manager.ts';
import { convertMCPToolsToAISDK } from './tools.ts';

export type MCPToolBrief = {
	name: string;
	server: string;
	description: string;
};

export function getMCPToolBriefs(manager: MCPServerManager): MCPToolBrief[] {
	return manager.getTools().map(({ name, server, tool: t }) => ({
		name,
		server,
		description: t.description ?? `MCP tool: ${t.name}`,
	}));
}

export function buildMCPToolCatalogDescription(briefs: MCPToolBrief[]): string {
	if (briefs.length === 0) return 'No MCP tools available.';
	const grouped = new Map<string, MCPToolBrief[]>();
	for (const b of briefs) {
		const list = grouped.get(b.server) ?? [];
		list.push(b);
		grouped.set(b.server, list);
	}
	const lines: string[] = [];
	for (const [server, tools] of grouped) {
		lines.push(`[${server}]`);
		for (const t of tools) {
			lines.push(`  ${t.name}: ${t.description.slice(0, 120)}`);
		}
	}
	return lines.join('\n');
}

export function buildLoadMCPToolsTool(briefs: MCPToolBrief[]): {
	name: string;
	tool: Tool;
} {
	const catalog = buildMCPToolCatalogDescription(briefs);
	const validNames = new Set(briefs.map((b) => b.name));

	return {
		name: 'load_mcp_tools',
		tool: tool({
			description: `Load MCP tools by name so they become available for use in the next step. Call this with the tool names you need before using them.\n\nAvailable MCP tools:\n${catalog}`,
			inputSchema: z.object({
				tools: z
					.array(z.string())
					.describe(
						'Array of MCP tool names to load (e.g. ["chrome__click", "chrome__screenshot"])',
					),
			}),
			execute: async ({ tools: requested }) => {
				const loaded: string[] = [];
				const notFound: string[] = [];
				for (const name of requested) {
					if (validNames.has(name)) {
						loaded.push(name);
					} else {
						notFound.push(name);
					}
				}
				return {
					ok: true,
					loaded,
					...(notFound.length > 0 ? { notFound } : {}),
				};
			},
		}),
	};
}

export function getMCPToolsRecord(
	manager: MCPServerManager,
): Record<string, Tool> {
	const mcpTools = convertMCPToolsToAISDK(manager);
	const record: Record<string, Tool> = {};
	for (const { name, tool: t } of mcpTools) {
		record[name] = t;
	}
	return record;
}
