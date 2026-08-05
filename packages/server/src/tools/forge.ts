import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import {
	FORGE_ACTIONS,
	FORGE_INPUT_KINDS,
	FORGE_MUTATIONS,
	FORGE_SCOPES,
	getForgeInventory,
	runForgeAction,
} from '../runtime/forge/index.ts';
import { executePluginCommandForAgent } from '../runtime/plugins/commands/index.ts';

const toolGroupsSchema = z.object({
	firstClass: z.array(z.string()).optional(),
	loadable: z.array(z.string()).optional(),
});

const inputSchema = z.object({
	action: z.enum(FORGE_ACTIONS).describe('Forge operation to perform.'),
	kind: z
		.enum(FORGE_INPUT_KINDS)
		.optional()
		.describe(
			'Capability kind. Required except for inventory and docs discovery.',
		),
	topic: z
		.string()
		.optional()
		.describe('Exact documentation topic. Omit to list topics for the kind.'),
	query: z
		.string()
		.optional()
		.describe('Search text for docs or the live agent capability catalog.'),
	scope: z
		.enum(FORGE_SCOPES)
		.optional()
		.describe(
			'Project writes under .otto; global writes under ~/.config/otto.',
		),
	name: z.string().optional().describe('Lowercase capability name.'),
	targetAction: z
		.enum(FORGE_MUTATIONS)
		.optional()
		.describe('Mutation to preview when action is plan.'),
	description: z.string().optional(),
	content: z
		.string()
		.optional()
		.describe('Recipe instructions, skill instructions, or agent prompt.'),
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe('Return the exact plan without writing.'),
	recipeAgent: z.string().optional().describe('Agent used by a recipe.'),
	includeInHistory: z.boolean().optional(),
	oneShot: z.boolean().optional(),
	allowedTools: z.array(z.string()).optional(),
	tools: toolGroupsSchema.optional().describe('Agent tool configuration.'),
	appendTools: toolGroupsSchema
		.optional()
		.describe('Tools appended to an agent default configuration.'),
	provider: z.string().optional(),
	model: z.string().optional(),
	transport: z.enum(['stdio', 'http', 'sse']).optional(),
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
	url: z.string().optional(),
	headers: z.record(z.string()).optional(),
	start: z
		.boolean()
		.optional()
		.describe('Start an MCP server immediately after create/update.'),
	operation: z
		.enum(['start', 'stop', 'restart'])
		.optional()
		.describe('MCP lifecycle operation when action is execute.'),
	plugin: z.string().optional().describe('Enabled plugin namespace.'),
	commandName: z.string().optional().describe('Plugin command name.'),
	commandArgs: z
		.record(z.union([z.string(), z.number(), z.boolean()]))
		.optional()
		.describe('Parsed plugin command arguments.'),
	argsText: z.string().optional().describe('Raw plugin command arguments.'),
	extraArgs: z.array(z.string()).optional(),
});

export function buildForgeTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'forge',
		tool: tool({
			description: `Create, manage, and run Otto capabilities.

Kinds:
- recipe, skill, agent: inventory, plan, create, update, or remove project/global capabilities
- mcp-server: inventory; plan/create/update/remove; enable/disable; execute start/stop/restart
- plugin-command: execute an enabled installed plugin command in a visible terminal
- docs: read local version-matched guides for recipe, skill, agent, mcp-server, plugin, or app; omit topic to discover topics

Project scope is the default. Use global only when explicitly requested. Prefer plan or dryRun before consequential configuration changes. MCP http/sse servers may return authRequired and authUrl; share that URL with the user.`,
			inputSchema,
			execute: async (input) => {
				try {
					if (input.action === 'docs' || input.action === 'capabilities') {
						return await runForgeAction(projectRoot, input);
					}
					if (input.action === 'inventory') {
						return {
							ok: true,
							inventory: await getForgeInventory(projectRoot),
						};
					}
					if (input.kind === 'plugin-command') {
						if (input.action !== 'execute') {
							throw new Error('plugin-command only supports action=execute');
						}
						if (!input.plugin?.trim() || !input.commandName?.trim()) {
							throw new Error(
								'plugin and commandName are required for plugin-command',
							);
						}
						if (input.dryRun) {
							throw new Error(
								'dryRun is not supported for plugin-command execution',
							);
						}
						return await executePluginCommandForAgent(projectRoot, {
							plugin: input.plugin,
							command: input.commandName,
							args: input.commandArgs,
							argsText: input.argsText,
							extraArgs: input.extraArgs,
						});
					}
					return await runForgeAction(projectRoot, input);
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		}),
	};
}
