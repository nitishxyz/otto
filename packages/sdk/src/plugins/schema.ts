import { z } from 'zod/v3';

export const pluginNameSchema = z
	.string()
	.min(1)
	.regex(/^[a-zA-Z0-9._-]+$/);

export const pluginPlatformSchema = z.enum(['darwin', 'linux', 'win32']);

const pluginRelativePathSchema = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.startsWith('/') &&
			!value.startsWith('\\') &&
			!value.startsWith('file:') &&
			!/^([A-Za-z]:)?[\\/]/.test(value) &&
			!value.split(/[\\/]/).includes('..'),
		{ message: 'Plugin path must stay within its payload directory' },
	);

const pluginSourcePatternsSchema = z.array(pluginRelativePathSchema);

export const pluginSourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('github'),
		repo: z.string().min(1),
		ref: z.string().optional(),
		path: z.string().min(1),
		include: pluginSourcePatternsSchema.optional(),
		exclude: pluginSourcePatternsSchema.optional(),
	}),
	z.object({
		type: z.literal('local'),
		path: z.string().min(1),
		include: pluginSourcePatternsSchema.optional(),
		exclude: pluginSourcePatternsSchema.optional(),
	}),
	z.object({
		type: z.literal('url'),
		url: z.string().url(),
	}),
]);

export const pluginSkillSchema = z
	.object({
		name: pluginNameSchema,
		path: pluginRelativePathSchema.optional(),
		description: z.string().optional(),
		source: pluginSourceSchema.optional(),
	})
	.refine((skill) => skill.path || skill.source, {
		message: 'Plugin skill requires either path or source',
	});

export const pluginRecipeSchema = z.object({
	name: pluginNameSchema,
	path: z.string().min(1),
	description: z.string().optional(),
});

const pluginAgentNameSchema = z
	.string()
	.min(1)
	.regex(/^[a-zA-Z0-9_-]+$/);

export const pluginAgentToolGroupsSchema = z.object({
	firstClass: z.array(z.string()).optional(),
	loadable: z.array(z.string()).optional(),
});

export const pluginAgentSchema = z
	.object({
		name: pluginAgentNameSchema,
		path: z.string().min(1).optional(),
		prompt: z.string().optional(),
		description: z.string().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
		tools: pluginAgentToolGroupsSchema.optional(),
		appendTools: pluginAgentToolGroupsSchema.optional(),
	})
	.refine((agent) => agent.path || agent.prompt, {
		message: 'Plugin agent requires either path or prompt',
	});

export const pluginCommandParameterSchema = z.object({
	type: z.enum(['string', 'number', 'boolean', 'enum']),
	description: z.string().optional(),
	required: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean()]).optional(),
	values: z.array(z.string()).optional(),
});

export const pluginCommandSchema: z.ZodType<PluginCommand> = z.lazy(() =>
	z.object({
		label: z.string().optional(),
		description: z.string().optional(),
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		env: z.record(z.string()).optional(),
		cwd: z.string().optional(),
		parameters: z.record(pluginCommandParameterSchema).optional(),
		allowExtraArgs: z.boolean().optional(),
		fallback: pluginCommandSchema.optional(),
	}),
);

export const pluginRequirementSchema = z.object({
	kind: z.enum(['platform', 'command', 'env', 'toolchain']),
	value: z.string().min(1),
	message: z.string().optional(),
});

export const pluginToolEffectSchema = z.enum([
	'workspace-read',
	'workspace-write',
	'process',
	'network',
	'secrets',
	'external-write',
]);

export const pluginToolSecretSchema = z.object({
	name: pluginNameSchema,
	env: z
		.string()
		.min(1)
		.regex(/^[A-Z_][A-Z0-9_]*$/),
	description: z.string().optional(),
	required: z.boolean().default(true),
});

const pluginToolEntrySchema = z
	.string()
	.min(1)
	.refine(
		(entry) => {
			if (entry.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry)) return false;
			return !entry.split(/[\\/]/).includes('..');
		},
		{ message: 'Plugin tool entry must stay within the plugin directory' },
	);

const jsonObjectSchema = z.record(z.unknown());

export const pluginToolSchema = z
	.object({
		name: pluginNameSchema,
		entry: pluginToolEntrySchema,
		description: z.string().min(1),
		inputSchema: jsonObjectSchema,
		outputSchema: jsonObjectSchema.optional(),
		effects: z.array(pluginToolEffectSchema).default([]),
		secrets: z.array(pluginToolSecretSchema).default([]),
		timeoutMs: z.number().int().min(100).max(900_000).default(120_000),
	})
	.superRefine((definition, context) => {
		if (
			definition.secrets.length > 0 &&
			!definition.effects.includes('secrets')
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['effects'],
				message: 'Tools declaring secrets must include the secrets effect',
			});
		}
	});

export const pluginManifestSchema = z.object({
	$schema: z.string().optional(),
	name: pluginNameSchema,
	displayName: z.string().optional(),
	publisher: z.string().optional(),
	version: z.string().min(1),
	description: z.string().optional(),
	homepage: z.string().optional(),
	repository: z.string().optional(),
	platforms: z.array(pluginPlatformSchema).optional(),
	tags: z.array(z.string()).optional(),
	skills: z.array(pluginSkillSchema).optional(),
	recipes: z.array(pluginRecipeSchema).optional(),
	agents: z.array(pluginAgentSchema).optional(),
	dependencies: z.array(pluginNameSchema).optional(),
	mcpServers: z.record(z.unknown()).optional(),
	commands: z.record(pluginCommandSchema).optional(),
	tools: z.array(pluginToolSchema).optional(),
	browser: z
		.object({
			previewUrl: z.string().optional(),
		})
		.optional(),
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
	version: z.literal(1).default(1),
	registries: z.array(z.string()).default([]),
	plugins: z.record(pluginConfigEntrySchema).default({}),
});

export const pluginRegistrySourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('github'),
		repo: z.string().min(1),
		ref: z.string().optional(),
		path: z.string().min(1),
	}),
	z.object({
		type: z.literal('local'),
		path: z.string().min(1),
	}),
]);

export const pluginRegistryEntrySchema = pluginManifestSchema
	.pick({
		name: true,
		displayName: true,
		publisher: true,
		version: true,
		description: true,
		homepage: true,
		repository: true,
		platforms: true,
		tags: true,
		skills: true,
		recipes: true,
		agents: true,
		dependencies: true,
		mcpServers: true,
		commands: true,
		tools: true,
		browser: true,
		requirements: true,
	})
	.extend({
		official: z.boolean().optional(),
		source: pluginRegistrySourceSchema.optional(),
	});

export const pluginRegistrySchema = z.object({
	$schema: z.string().optional(),
	version: z.literal(1),
	plugins: z.array(pluginRegistryEntrySchema).default([]),
});

export const DEFAULT_PLUGIN_REGISTRY_URL =
	'https://raw.githubusercontent.com/nitishxyz/otto/main/packages/plugin-registry/registry.json';

export type PluginScope = 'global' | 'project';
export type PluginStatus = 'installed' | 'missing' | 'invalid';
export type PluginCommandParameterType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'enum';

export type PluginCommandParameter = {
	type: PluginCommandParameterType;
	description?: string;
	required?: boolean;
	default?: string | number | boolean;
	values?: string[];
};

export type PluginCommand = {
	label?: string;
	description?: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	parameters?: Record<string, PluginCommandParameter>;
	allowExtraArgs?: boolean;
	fallback?: PluginCommand;
};
export type PluginTool = z.infer<typeof pluginToolSchema>;
export type PluginToolEffect = z.infer<typeof pluginToolEffectSchema>;
export type PluginToolSecret = z.infer<typeof pluginToolSecretSchema>;
export type PluginSource = z.infer<typeof pluginSourceSchema>;
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginConfigEntry = z.infer<typeof pluginConfigEntrySchema>;
export type PluginsConfig = z.infer<typeof pluginsConfigSchema>;
export type PluginRegistry = z.infer<typeof pluginRegistrySchema>;
export type PluginRegistryEntry = z.infer<typeof pluginRegistryEntrySchema>;

export type DiscoveredPlugin = {
	name: string;
	scope: PluginScope;
	dir: string;
	manifestPath: string;
	configEntry?: PluginConfigEntry;
	enabled: boolean;
	installed: boolean;
	status: PluginStatus;
	manifest?: PluginManifest;
	error?: string;
};

export type PluginsScopeState = {
	scope: PluginScope;
	configPath: string;
	pluginsDir: string;
	config: PluginsConfig;
	plugins: DiscoveredPlugin[];
};

export type EffectivePlugin = DiscoveredPlugin & {
	overriddenByProject?: boolean;
};

export type EffectivePlugins = {
	global: PluginsScopeState;
	project: PluginsScopeState;
	plugins: EffectivePlugin[];
};

export type FetchPluginRegistryOptions = {
	url?: string;
	fetch?: typeof fetch;
};

export type ResolveRegistryPluginOptions = FetchPluginRegistryOptions & {
	registries?: string[];
};

export type PluginInstallOptions = ResolveRegistryPluginOptions & {
	scope?: PluginScope;
	projectRoot?: string;
	enabled?: boolean;
};
