import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import { loadConfig } from '../config/src/index.ts';
import {
	MEMORY_LINK_TYPES,
	memoryProjectId,
	openMemory,
	type MemoryContext,
	type MemoryLinkType,
} from './index.ts';

/** Serve the same user-local memory to external agents over MCP stdio. */
export async function serveMemoryMCP(projectRoot: string): Promise<void> {
	const context: MemoryContext = { projectRoot: memoryProjectId(projectRoot) };
	const config = await loadConfig(context.projectRoot);
	if (config.memory?.enabled === false)
		throw new Error('Memory is disabled in user settings');
	const server = new McpServer({ name: 'otto-memory', version: '1.0.0' });
	const clientAgent = () => {
		const name = server.server.getClientVersion()?.name.trim();
		return name && /^[\w.-]{1,64}$/.test(name) ? `mcp:${name}` : 'mcp';
	};
	server.registerTool(
		'recall_memory',
		{
			description:
				'Search project and personal memories by keyword and meaning. Results are historical user-level context: stable preferences may guide work when they apply, but current user and system instructions take precedence; verify facts before use.',
			inputSchema: {
				query: z.string().min(1),
				limit: z.number().int().min(1).max(10).optional(),
			},
		},
		async ({ query, limit }) => {
			const memory = await openMemory(
				undefined,
				config.judge,
				context.projectRoot,
				clientAgent(),
				config.memory,
			);
			try {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								await memory.recall(query, context, { limit }),
							),
						},
					],
				};
			} finally {
				memory.close();
			}
		},
	);
	server.registerTool(
		'core_memory',
		{
			description:
				'Load the budgeted baseline of core memories (standing user preferences and project conventions) for this project, selected by TypeSafe for the optional task when configured. Call once at the start of a session; `overflow` lists core memories that did not fit (use recall_memory for them). Current user and system instructions take precedence.',
			inputSchema: { task: z.string().max(2000).optional() },
		},
		async ({ task }) => {
			const memory = await openMemory(
				undefined,
				config.judge,
				context.projectRoot,
				clientAgent(),
				config.memory,
			);
			try {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								await memory.baseline(context, { task, role: 'main' }),
							),
						},
					],
				};
			} finally {
				memory.close();
			}
		},
	);
	server.registerTool(
		'remember',
		{
			description:
				"Store an explicit durable memory or the user's stable preference. Project scope is bound to this MCP process; global scope is shared everywhere. No credentials or one-off task details. priority core = always loaded on every turn (bounded); contextual (default) = found by search. audience orchestration = main-agent-only process preference (sub-agent context tracking, compaction/new-session thresholds); work = applies to the work. replacesId corrects a memory (unspecified metadata is inherited); links relate it to accessible memories.",
			inputSchema: {
				content: z.string().min(1).max(2000),
				scope: z.enum(['project', 'global']),
				source: z.string().min(1).max(256),
				replacesId: z.string().uuid().optional(),
				priority: z.enum(['core', 'contextual']).optional(),
				audience: z.enum(['work', 'orchestration']).optional(),
				links: z
					.array(
						z.object({
							type: z.enum(
								MEMORY_LINK_TYPES as [MemoryLinkType, ...MemoryLinkType[]],
							),
							id: z.string().uuid(),
						}),
					)
					.max(8)
					.optional(),
			},
		},
		async (input) => {
			const memory = await openMemory(
				undefined,
				config.judge,
				context.projectRoot,
				clientAgent(),
				config.memory,
			);
			try {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								await memory.remember(
									{ ...input, origin: 'explicit' },
									context,
								),
							),
						},
					],
				};
			} finally {
				memory.close();
			}
		},
	);
	server.registerTool(
		'memory_history',
		{
			description:
				'Get the authorized timeline, current head and links of a memory.',
			inputSchema: { id: z.string().uuid() },
		},
		async ({ id }) => {
			const memory = await openMemory(
				undefined,
				config.judge,
				context.projectRoot,
			);
			try {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ lineage: memory.lineage(id, context) }),
						},
					],
				};
			} finally {
				memory.close();
			}
		},
	);
	server.registerTool(
		'forget_memory',
		{
			description:
				'Permanently forget an accessible memory and all its revisions.',
			inputSchema: { id: z.string().uuid() },
		},
		async ({ id }) => {
			const memory = await openMemory(
				undefined,
				config.judge,
				context.projectRoot,
				clientAgent(),
				config.memory,
			);
			try {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ forgotten: memory.forget(id, context) }),
						},
					],
				};
			} finally {
				memory.close();
			}
		},
	);
	await server.connect(new StdioServerTransport());
}
