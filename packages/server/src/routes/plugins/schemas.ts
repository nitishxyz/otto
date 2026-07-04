import { z } from '@hono/zod-openapi';

export const pluginScopeSchema = z.enum(['global', 'project']);

export const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

export const registryQuerySchema = projectQuerySchema.extend({
	url: z
		.string()
		.optional()
		.openapi({
			param: { name: 'url', in: 'query' },
			description: 'Registry URL override.',
		}),
});

export const pluginNameParamsSchema = z.object({
	name: z.string().openapi({ param: { name: 'name', in: 'path' } }),
});

export const pluginSourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('github'),
		repo: z.string(),
		ref: z.string().optional(),
		path: z.string(),
		include: z.array(z.string()).optional(),
		exclude: z.array(z.string()).optional(),
	}),
	z.object({
		type: z.literal('local'),
		path: z.string(),
		include: z.array(z.string()).optional(),
		exclude: z.array(z.string()).optional(),
	}),
	z.object({
		type: z.literal('url'),
		url: z.string(),
	}),
]);

export const pluginSkillSchema = z.object({
	name: z.string(),
	path: z.string().optional(),
	description: z.string().optional(),
	source: pluginSourceSchema.optional(),
});

export const pluginRecipeSchema = z.object({
	name: z.string(),
	path: z.string(),
	description: z.string().optional(),
});

export const pluginAgentToolGroupsSchema = z.object({
	firstClass: z.array(z.string()).optional(),
	loadable: z.array(z.string()).optional(),
});

export const pluginAgentSchema = z.object({
	name: z.string(),
	path: z.string().optional(),
	prompt: z.string().optional(),
	description: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	tools: pluginAgentToolGroupsSchema.optional(),
	appendTools: pluginAgentToolGroupsSchema.optional(),
});

export const pluginCommandParameterSchema = z.object({
	type: z.enum(['string', 'number', 'boolean', 'enum']),
	description: z.string().optional(),
	required: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean()]).optional(),
	values: z.array(z.string()).optional(),
});

const pluginCommandDefinitionSchema = z.object({
	label: z.string().optional(),
	description: z.string().optional(),
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	cwd: z.string().optional(),
	parameters: z.record(z.string(), pluginCommandParameterSchema).optional(),
	allowExtraArgs: z.boolean().optional(),
});

export const pluginCommandSchema = pluginCommandDefinitionSchema.extend({
	fallback: pluginCommandDefinitionSchema.optional(),
});

export const pluginRequirementSchema = z.object({
	kind: z.enum(['platform', 'command', 'env', 'toolchain']),
	value: z.string(),
	message: z.string().optional(),
});

export const pluginManifestSchema = z.object({
	$schema: z.string().optional(),
	name: z.string(),
	displayName: z.string().optional(),
	publisher: z.string().optional(),
	version: z.string(),
	description: z.string().optional(),
	homepage: z.string().optional(),
	repository: z.string().optional(),
	platforms: z.array(z.enum(['darwin', 'linux', 'win32'])).optional(),
	tags: z.array(z.string()).optional(),
	skills: z.array(pluginSkillSchema).optional(),
	recipes: z.array(pluginRecipeSchema).optional(),
	agents: z.array(pluginAgentSchema).optional(),
	dependencies: z.array(z.string()).optional(),
	mcpServers: z.record(z.string(), z.unknown()).optional(),
	commands: z.record(z.string(), pluginCommandSchema).optional(),
	browser: z.object({ previewUrl: z.string().optional() }).optional(),
	requirements: z.array(pluginRequirementSchema).optional(),
});

export const pluginConfigEntrySchema = z.object({
	enabled: z.boolean(),
	source: z.string().optional(),
	version: z.string().optional(),
	installedAt: z.string().optional(),
	updatedAt: z.string().optional(),
	pinned: z.boolean().optional(),
	installedBy: z.array(z.string()).optional(),
});

export const pluginsConfigSchema = z.object({
	$schema: z.string().optional(),
	version: z.literal(1),
	registries: z.array(z.string()),
	plugins: z.record(z.string(), pluginConfigEntrySchema),
});

export const discoveredPluginSchema = z.object({
	name: z.string(),
	scope: pluginScopeSchema,
	dir: z.string(),
	manifestPath: z.string(),
	configEntry: pluginConfigEntrySchema.optional(),
	enabled: z.boolean(),
	installed: z.boolean(),
	status: z.enum(['installed', 'missing', 'invalid']),
	manifest: pluginManifestSchema.optional(),
	error: z.string().optional(),
});

export const effectivePluginSchema = discoveredPluginSchema.extend({
	overriddenByProject: z.boolean().optional(),
});

export const pluginsScopeStateSchema = z.object({
	scope: pluginScopeSchema,
	configPath: z.string(),
	pluginsDir: z.string(),
	config: pluginsConfigSchema,
	plugins: z.array(discoveredPluginSchema),
});

export const pluginsListResponseSchema = z.object({
	global: pluginsScopeStateSchema,
	project: pluginsScopeStateSchema,
	plugins: z.array(effectivePluginSchema),
});

export const pluginRegistrySourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('github'),
		repo: z.string(),
		ref: z.string().optional(),
		path: z.string(),
	}),
	z.object({
		type: z.literal('local'),
		path: z.string(),
	}),
]);

export const pluginRegistryEntrySchema = z.object({
	name: z.string(),
	displayName: z.string().optional(),
	publisher: z.string().optional(),
	version: z.string(),
	description: z.string().optional(),
	homepage: z.string().optional(),
	repository: z.string().optional(),
	platforms: z.array(z.enum(['darwin', 'linux', 'win32'])).optional(),
	tags: z.array(z.string()).optional(),
	skills: z.array(pluginSkillSchema).optional(),
	recipes: z.array(pluginRecipeSchema).optional(),
	agents: z.array(pluginAgentSchema).optional(),
	dependencies: z.array(z.string()).optional(),
	mcpServers: z.record(z.string(), z.unknown()).optional(),
	commands: z.record(z.string(), pluginCommandSchema).optional(),
	browser: z.object({ previewUrl: z.string().optional() }).optional(),
	requirements: z.array(pluginRequirementSchema).optional(),
	official: z.boolean().optional(),
	source: pluginRegistrySourceSchema.optional(),
	registryUrl: z.string().optional(),
});

export const pluginRegistryResponseSchema = z.object({
	registries: z.array(z.string()),
	plugins: z.array(pluginRegistryEntrySchema),
});

export const pluginDetailResponseSchema = z.object({
	plugin: effectivePluginSchema.optional(),
	registry: pluginRegistryEntrySchema.optional(),
});

const registryOptionsBodySchema = z.object({
	project: z.string().optional(),
	url: z.string().optional(),
	registries: z.array(z.string()).optional(),
});

export const pluginInstallBodySchema = registryOptionsBodySchema.extend({
	source: z.string(),
	scope: pluginScopeSchema.optional(),
	enabled: z.boolean().optional(),
});

export const pluginMutationBodySchema = z.object({
	name: z.string(),
	scope: pluginScopeSchema.optional(),
	project: z.string().optional(),
});

export const pluginUpdateBodySchema = registryOptionsBodySchema.extend({
	name: z.string().optional(),
	scope: pluginScopeSchema.optional(),
});

export const pluginMutationResponseSchema = z.object({
	success: z.boolean(),
	plugin: discoveredPluginSchema.optional(),
});

export const pluginUpdateResponseSchema = z.object({
	success: z.boolean(),
	plugin: discoveredPluginSchema.optional(),
	plugins: z.array(discoveredPluginSchema).optional(),
});

export const pluginCommandListEntrySchema = z.object({
	plugin: z.string(),
	command: z.string(),
	label: z.string().optional(),
	description: z.string().optional(),
	parameters: z.record(z.string(), pluginCommandParameterSchema).optional(),
	allowExtraArgs: z.boolean().optional(),
	previewUrl: z.string().optional(),
	scope: pluginScopeSchema,
});

export const pluginCommandsListResponseSchema = z.object({
	commands: z.array(pluginCommandListEntrySchema),
});

export const pluginCommandParamsSchema = z.object({
	plugin: z.string().openapi({ param: { name: 'plugin', in: 'path' } }),
	command: z.string().openapi({ param: { name: 'command', in: 'path' } }),
});

export const pluginCommandRunBodySchema = z.object({
	project: z.string().optional(),
	argsText: z.string().optional(),
	args: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional(),
	extraArgs: z.array(z.string()).optional(),
});

export const pluginCommandRunResponseSchema = z.object({
	command: z.string(),
	terminalId: z.string(),
	title: z.string(),
	previewUrl: z.string().optional(),
	execution: z.literal('started'),
});

export const apiErrorResponseSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		code: z.string().optional(),
		status: z.number().optional(),
		details: z.record(z.string(), z.unknown()).optional(),
		stack: z.string().optional(),
	}),
});
