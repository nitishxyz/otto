import { z } from '@hono/zod-openapi';
import {
	discoverProjectTools,
	getLazyToolDefinitions,
	loadConfig,
	logger,
} from '@ottocode/sdk';
import type { Tool } from 'ai';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { buildDatabaseTools } from '../../tools/database/index.ts';
import { buildSubagentTools } from '../../tools/subagents/index.ts';
import { buildGoalTools } from '../../tools/goals/index.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const REQUIRED_TOOLS = new Set(['progress_update', 'load_tools']);
const RISKY_TOOLS = new Set([
	'shell',
	'terminal',
	'run_plugin_command',
	'write',
	'apply_patch',
	'git_commit',
]);

const BUILTIN_TOOLS = new Set([
	'progress_update',
	'update_todos',
	'read',
	'read_image',
	'write',
	'edit',
	'multiedit',
	'copy_into',
	'copy_attachment_to_project',
	'ls',
	'tree',
	'glob',
	'search',
	'shell',
	'terminal',
	'apply_patch',
	'git_status',
	'git_diff',
	'git_commit',
	'websearch',
	'skill',
	'load_tools',
	'load_mcp_tools',
]);

const RESEARCH_TOOLS = new Set([
	'query_sessions',
	'query_messages',
	'get_session_context',
	'search_history',
	'present_action',
]);

const ORCHESTRATION_TOOLS = new Set([
	'delegate_task',
	'list_subagents',
	'message_subagent',
	'retry_subagent',
	'goal_list',
	'goal_update',
	'enqueue_session_message',
]);

const getToolsQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const toolDetailSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	category: z.enum([
		'first_class',
		'loadable',
		'core',
		'filesystem',
		'search',
		'editing',
		'shell',
		'git',
		'web',
		'mcp',
		'skill',
		'research',
		'orchestration',
		'custom',
		'other',
	]),
	source: z.enum(['builtin', 'mcp', 'skill', 'custom']),
	activation: z.enum(['first_class', 'loadable', 'mcp']).optional(),
	required: z.boolean().optional(),
	risky: z.boolean().optional(),
	available: z.boolean(),
});

const getToolsResponseSchema = z.object({
	tools: z.array(toolDetailSchema),
});

type ToolCategory = z.infer<typeof toolDetailSchema>['category'];
type ToolSource = z.infer<typeof toolDetailSchema>['source'];

type ToolDetail = z.infer<typeof toolDetailSchema>;

function getToolDescription(tool: Tool | undefined): string | undefined {
	const description = (tool as { description?: unknown } | undefined)
		?.description;
	return typeof description === 'string' && description.trim()
		? description.trim()
		: undefined;
}

function getToolCategory(name: string): ToolCategory {
	if (name === 'load_tools') return 'first_class';
	if (['progress_update', 'update_todos'].includes(name)) {
		return 'core';
	}
	if (
		[
			'read',
			'read_image',
			'ls',
			'tree',
			'glob',
			'copy_into',
			'copy_attachment_to_project',
		].includes(name)
	) {
		return 'filesystem';
	}
	if (['edit', 'multiedit', 'write', 'apply_patch'].includes(name)) {
		return 'editing';
	}
	if (name === 'search') return 'search';
	if (['shell', 'terminal'].includes(name)) return 'shell';
	if (name.startsWith('git_')) return 'git';
	if (name === 'websearch') return 'web';
	if (name === 'skill') return 'skill';
	if (RESEARCH_TOOLS.has(name)) return 'research';
	if (ORCHESTRATION_TOOLS.has(name)) return 'orchestration';
	if (name.includes('__') || name === 'load_mcp_tools') return 'mcp';
	if (BUILTIN_TOOLS.has(name)) return 'other';
	return 'custom';
}

function getToolSource(name: string, options: { mcp: boolean }): ToolSource {
	if (options.mcp || name.includes('__') || name === 'load_mcp_tools')
		return 'mcp';
	if (name === 'skill') return 'skill';
	if (
		BUILTIN_TOOLS.has(name) ||
		RESEARCH_TOOLS.has(name) ||
		ORCHESTRATION_TOOLS.has(name)
	)
		return 'builtin';
	return 'custom';
}

function toToolDetail(args: {
	name: string;
	tool?: Tool;
	mcp?: boolean;
	available?: boolean;
	activation?: ToolDetail['activation'];
}): ToolDetail {
	return {
		name: args.name,
		description: getToolDescription(args.tool),
		category: getToolCategory(args.name),
		source: getToolSource(args.name, { mcp: Boolean(args.mcp) }),
		activation:
			args.activation ?? (args.mcp ? 'mcp' : ('first_class' as const)),
		required: REQUIRED_TOOLS.has(args.name) || undefined,
		risky: RISKY_TOOLS.has(args.name) || undefined,
		available: args.available ?? true,
	};
}

export function registerToolsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/tools',
			tags: ['config'],
			operationId: 'getConfigTools',
			summary: 'Get available tools for agent configuration',
			request: { query: getToolsQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: getToolsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const cfg = await loadConfig(projectRoot);
				const discovered = await discoverProjectTools(
					cfg.projectRoot,
					undefined,
					cfg.skills,
				);
				const details = new Map<string, ToolDetail>();

				for (const item of discovered.tools) {
					details.set(
						item.name,
						toToolDetail({ name: item.name, tool: item.tool }),
					);
				}

				for (const item of buildDatabaseTools(cfg.projectRoot, null)) {
					details.set(
						item.name,
						toToolDetail({ name: item.name, tool: item.tool }),
					);
				}

				for (const item of [
					...buildSubagentTools(cfg.projectRoot, ''),
					...buildGoalTools({
						projectRoot: cfg.projectRoot,
						looperSessionId: '',
					}),
				]) {
					details.set(
						item.name,
						toToolDetail({ name: item.name, tool: item.tool }),
					);
				}

				const lazyDescriptions = new Map(
					getLazyToolDefinitions().map(({ name, description }) => [
						name,
						description,
					]),
				);
				for (const [name, tool] of Object.entries(discovered.lazyToolsRecord)) {
					details.set(name, {
						...toToolDetail({
							name,
							tool,
							activation: 'loadable',
						}),
						category: 'loadable',
						description: lazyDescriptions.get(name) ?? getToolDescription(tool),
						source: 'builtin',
						available: true,
					});
				}

				for (const [name, tool] of Object.entries(discovered.mcpToolsRecord)) {
					details.set(name, toToolDetail({ name, tool, mcp: true }));
				}

				return c.json({
					tools: Array.from(details.values()).sort((a, b) =>
						a.name.localeCompare(b.name),
					),
				});
			} catch (error) {
				logger.error('Failed to get config tools', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
