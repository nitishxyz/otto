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

const providerCompatibilitySchema = z.enum([
	'ollama',
	'openai-compatible',
	'openai',
	'anthropic',
	'google',
	'openrouter',
]);

const providerFamilySchema = z.enum([
	'default',
	'openai',
	'anthropic',
	'google',
	'kimi',
	'glm',
	'minimax',
	'openai-compatible',
]);

const providerModelSchema = z.object({
	id: z.string(),
	label: z.string().optional(),
	ownedBy: z
		.enum([
			'openai',
			'anthropic',
			'google',
			'meta',
			'openrouter',
			'xai',
			'kimi',
			'qwen',
			'zai',
			'deepseek',
			'minimax',
		])
		.optional(),
	provider: z
		.object({
			id: z.string().optional(),
			npm: z.string().optional(),
			compatibility: providerCompatibilitySchema.optional(),
			api: z.string().optional(),
			baseURL: z.string().optional(),
			family: providerFamilySchema.optional(),
		})
		.optional(),
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
	label: z.string().optional().describe('Display label.'),
	content: z
		.string()
		.optional()
		.describe('Instructions, prompt, or native tool source code.'),
	source: z
		.string()
		.optional()
		.describe('Plugin registry name or local directory for installation.'),
	version: z.string().optional(),
	displayName: z.string().optional(),
	publisher: z.string().optional(),
	homepage: z.string().optional(),
	repository: z.string().optional(),
	platforms: z.array(z.enum(['darwin', 'linux', 'win32'])).optional(),
	tags: z.array(z.string()).optional(),
	dependencies: z.array(z.string()).optional(),
	requirements: z
		.array(
			z.object({
				kind: z.enum(['platform', 'command', 'env', 'toolchain']),
				value: z.string(),
				message: z.string().optional(),
			}),
		)
		.optional(),
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
	compatibility: providerCompatibilitySchema.optional(),
	family: providerFamilySchema.optional(),
	baseURL: z.string().optional(),
	apiKeyEnv: z.string().optional(),
	models: z.array(z.union([z.string(), providerModelSchema])).optional(),
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
	toolName: z.string().optional().describe('Native plugin tool name.'),
	entry: z.string().optional().describe('Tool entry path inside its plugin.'),
	inputSchema: z.record(z.unknown()).optional(),
	outputSchema: z.record(z.unknown()).optional(),
	effects: z
		.array(
			z.enum([
				'workspace-read',
				'workspace-write',
				'process',
				'network',
				'secrets',
				'external-write',
			]),
		)
		.optional(),
	secrets: z
		.array(
			z.object({
				name: z.string(),
				env: z.string(),
				description: z.string().optional(),
				required: z.boolean().optional(),
			}),
		)
		.optional(),
	timeoutMs: z.number().int().min(100).max(900_000).optional(),
	toolInput: z
		.record(z.unknown())
		.optional()
		.describe('Input passed to a native plugin tool execution.'),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
	cwd: z.string().optional(),
	parameters: z
		.record(
			z.object({
				type: z.enum(['string', 'number', 'boolean', 'enum']),
				description: z.string().optional(),
				required: z.boolean().optional(),
				default: z.union([z.string(), z.number(), z.boolean()]).optional(),
				values: z.array(z.string()).optional(),
			}),
		)
		.optional(),
	allowExtraArgs: z.boolean().optional(),
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
			description: `Create, manage, and run Otto extensions and control-plane resources.

Kinds:
- recipe, skill, agent: inventory, plan, create, update, or remove standalone capabilities; set plugin to mutate a contribution inside an editable local plugin
- plugin: create unpublished local plugins; install/search/status/update/remove/enable/disable/validate plugin packages
- plugin-tool: plan/create/update/remove/validate/execute native tools inside editable local plugins
- mcp-server: inventory/status; plan/create/update/remove; enable/disable; authenticate/reauthenticate/logout; execute start/stop/restart
- provider: inventory/status; plan/create/update/remove; enable/disable provider definitions and overrides
- auth: inventory/status; authenticate/reauthenticate with API keys or OAuth; logout/remove credentials
- tunnel: inventory/status; enable/disable; execute start/stop/restart for managed or quick tunnels
- plugin-command: plan/create/update/remove terminal-backed namespaced slash commands; execute them in visible terminals
- docs: authoritative, local, version-matched guides for recipe, skill, agent, plugin, plugin-tool, mcp-server, provider, auth, tunnel, or app; omit topic to discover topics

Project scope is the default for extension work, including unpublished local plugins. Providers, auth, and machine tunnels are global. Prefer plan or dryRun before consequential configuration changes. OAuth and MCP servers may return authUrl/userCode; share them with the user. Never repeat apiKey or secret values.`,
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
							return await runForgeAction(projectRoot, input);
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
