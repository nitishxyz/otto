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
	label: z.string().optional().describe('Display label for a provider.'),
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
	compatibility: z
		.enum([
			'ollama',
			'openai-compatible',
			'openai',
			'anthropic',
			'google',
			'openrouter',
		])
		.optional(),
	family: z
		.enum([
			'default',
			'openai',
			'anthropic',
			'google',
			'kimi',
			'glm',
			'minimax',
		])
		.optional(),
	baseURL: z.string().optional(),
	apiKeyEnv: z.string().optional(),
	models: z.array(z.string()).optional(),
	fastModels: z.array(z.string()).optional(),
	allowAnyModel: z.boolean().optional(),
	modelDiscovery: z.enum(['openai-models', 'ollama', 'none']).optional(),
	apiKey: z
		.string()
		.optional()
		.describe(
			'Provider API key. Accepted only by auth actions and never returned.',
		),
	authMethod: z.enum(['api-key', 'oauth']).optional(),
	oauthMode: z.enum(['browser', 'device']).optional(),
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
		.describe('MCP or tunnel lifecycle operation when action is execute.'),
	tunnelMode: z.enum(['managed', 'quick']).optional(),
	tunnelScope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().optional(),
	port: z.number().int().positive().optional(),
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
			description: `Create, manage, and run Otto-specific extensions and control-plane resources. Use Forge only when the user explicitly asks to manage Otto recipes, skills, agents, MCP servers, providers, authentication, tunnels, plugins, Mini Apps, or their documentation. Never reinterpret ordinary project work such as building a website or app as a Forge operation.

Kinds:
- recipe, skill, agent: inventory, plan, create, update, or remove project/global capabilities
- mcp-server: inventory/status; plan/create/update/remove; enable/disable; authenticate/reauthenticate/logout; execute start/stop/restart
- provider: inventory/status; plan/create/update/remove; enable/disable provider definitions and overrides
- auth: inventory/status; authenticate/reauthenticate with API keys or OAuth; logout/remove credentials
- tunnel: inventory/status; enable/disable; execute start/stop/restart for managed or quick tunnels
- plugin-command: execute an enabled installed plugin command in a visible terminal
- docs: authoritative, local, version-matched guides for recipe, skill, agent, mcp-server, provider, auth, tunnel, plugin, or app; omit topic to discover topics

Project scope is the default for explicit extension work. Providers, auth, and machine tunnels are global. Prefer plan or dryRun before consequential configuration changes. OAuth and MCP servers may return authUrl/userCode; share them with the user. Never repeat apiKey values.`,
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
