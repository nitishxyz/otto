import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import type { MCPToolClassification } from './classify.ts';
import type { MCPServerManager } from './server-manager.ts';
import { convertMCPToolsToAISDK } from './tools.ts';

export type MCPToolBrief = {
	name: string;
	server: string;
	description: string;
};

const DESCRIPTION_LIMIT = 120;

export function getMCPToolBriefs(manager: MCPServerManager): MCPToolBrief[] {
	return manager.getTools().map(({ name, server, tool: t }) => ({
		name,
		server,
		description: t.description ?? `MCP tool: ${t.name}`,
	}));
}

function groupByServer(briefs: MCPToolBrief[]): Map<string, MCPToolBrief[]> {
	const grouped = new Map<string, MCPToolBrief[]>();
	for (const b of briefs) {
		const list = grouped.get(b.server) ?? [];
		list.push(b);
		grouped.set(b.server, list);
	}
	return grouped;
}

export type MCPToolCatalogOptions = {
	/**
	 * Tools already active for this turn. When present, the catalog lists them
	 * first with descriptions and lists the rest by name only, which keeps the
	 * per-step tool definition small without hiding anything.
	 */
	preloaded?: ReadonlySet<string>;
};

export function buildMCPToolCatalogDescription(
	briefs: MCPToolBrief[],
	options: MCPToolCatalogOptions = {},
): string {
	if (briefs.length === 0) return 'No MCP tools available.';
	const preloaded = options.preloaded;
	if (!preloaded || preloaded.size === 0) {
		const lines: string[] = [];
		for (const [server, tools] of groupByServer(briefs)) {
			lines.push(`[${server}]`);
			for (const t of tools) {
				lines.push(`  ${t.name}: ${t.description.slice(0, DESCRIPTION_LIMIT)}`);
			}
		}
		return lines.join('\n');
	}

	const active = briefs.filter((b) => preloaded.has(b.name));
	const rest = briefs.filter((b) => !preloaded.has(b.name));
	const lines: string[] = [];
	if (active.length > 0) {
		lines.push('Already loaded for this request (no need to load again):');
		for (const [server, tools] of groupByServer(active)) {
			lines.push(`[${server}]`);
			for (const t of tools) {
				lines.push(`  ${t.name}: ${t.description.slice(0, DESCRIPTION_LIMIT)}`);
			}
		}
	}
	if (rest.length > 0) {
		lines.push('Other MCP tools (load by name if needed):');
		for (const [server, tools] of groupByServer(rest)) {
			lines.push(`[${server}] ${tools.map((t) => t.name).join(', ')}`);
		}
	}
	return lines.join('\n');
}

export function buildLoadMCPToolsTool(
	briefs: MCPToolBrief[],
	options: MCPToolCatalogOptions = {},
): {
	name: string;
	tool: Tool;
} {
	const catalog = buildMCPToolCatalogDescription(briefs, options);
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
	classifications?: ReadonlyMap<string, MCPToolClassification>,
): Record<string, Tool> {
	const mcpTools = convertMCPToolsToAISDK(manager, classifications);
	const record: Record<string, Tool> = {};
	for (const { name, tool: t } of mcpTools) {
		record[name] = t;
	}
	return record;
}
