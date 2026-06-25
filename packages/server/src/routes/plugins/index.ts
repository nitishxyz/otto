import {
	DEFAULT_PLUGIN_REGISTRY_URL,
	fetchPluginRegistry,
	installPlugin,
	loadPluginsConfig,
	logger,
	removePlugin,
	resolveEffectivePlugins,
	setPluginEnabled,
	updatePlugin,
	type PluginRegistryEntry,
	type PluginScope,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { APIError, serializeError } from '../../runtime/errors/api-error.ts';
import {
	apiErrorResponseSchema,
	pluginDetailResponseSchema,
	pluginInstallBodySchema,
	pluginMutationBodySchema,
	pluginMutationResponseSchema,
	pluginNameParamsSchema,
	pluginRegistryResponseSchema,
	pluginUpdateBodySchema,
	pluginUpdateResponseSchema,
	pluginsListResponseSchema,
	projectQuerySchema,
	registryQuerySchema,
} from './schemas.ts';

function getProjectRoot(project?: string): string {
	return project || process.cwd();
}

function getRegistryOptions(input: { url?: string; registries?: string[] }): {
	url?: string;
	registries?: string[];
} {
	return {
		...(input.url ? { url: input.url } : {}),
		...(input.registries?.length ? { registries: input.registries } : {}),
	};
}

async function getRegistryUrls(
	projectRoot: string,
	url?: string,
): Promise<string[]> {
	if (url) return [url];

	const [globalConfig, projectConfig] = await Promise.all([
		loadPluginsConfig('global'),
		loadPluginsConfig('project', projectRoot),
	]);
	const urls = [
		...globalConfig.registries,
		...projectConfig.registries,
		DEFAULT_PLUGIN_REGISTRY_URL,
	];
	return Array.from(new Set(urls));
}

async function fetchRegistries(projectRoot: string, url?: string) {
	const registries = await getRegistryUrls(projectRoot, url);
	const entries = new Map<
		string,
		PluginRegistryEntry & { registryUrl: string }
	>();

	for (const registryUrl of registries) {
		const registry = await fetchPluginRegistry({ url: registryUrl });
		for (const plugin of registry.plugins) {
			if (!entries.has(plugin.name)) {
				entries.set(plugin.name, { ...plugin, registryUrl });
			}
		}
	}

	return {
		registries,
		plugins: Array.from(entries.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		),
	};
}

function errorJson(
	c: Parameters<Parameters<typeof zodOpenApiRoute>[2]>[0],
	error: unknown,
) {
	const errorResponse = serializeError(error);
	return c.json(errorResponse, errorResponse.error.status || 500);
}

export function registerPluginsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/plugins',
			tags: ['plugins'],
			operationId: 'listPlugins',
			summary: 'List effective, global, and project plugins',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pluginsListResponseSchema },
					},
				},
				'400': {
					description: 'Invalid request',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				return c.json(
					await resolveEffectivePlugins(getProjectRoot(c.req.query('project'))),
				);
			} catch (error) {
				logger.error('Failed to list plugins', error);
				return errorJson(c, error);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/plugins/registry',
			tags: ['plugins'],
			operationId: 'listPluginRegistry',
			summary: 'List available registry plugins',
			request: { query: registryQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pluginRegistryResponseSchema },
					},
				},
				'400': {
					description: 'Invalid request',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				return c.json(
					await fetchRegistries(
						getProjectRoot(c.req.query('project')),
						c.req.query('url'),
					),
				);
			} catch (error) {
				logger.error('Failed to list plugin registry', error);
				return errorJson(c, error);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/plugins/{name}',
			tags: ['plugins'],
			operationId: 'getPlugin',
			summary: 'Get plugin detail',
			request: {
				params: pluginNameParamsSchema,
				query: registryQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pluginDetailResponseSchema },
					},
				},
				'404': {
					description: 'Not found',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const name = c.req.param('name');
				const projectRoot = getProjectRoot(c.req.query('project'));
				const effective = await resolveEffectivePlugins(projectRoot);
				const plugin = effective.plugins.find((item) => item.name === name);
				let registry:
					| (PluginRegistryEntry & { registryUrl?: string })
					| undefined;

				try {
					registry = (
						await fetchRegistries(projectRoot, c.req.query('url'))
					).plugins.find((item) => item.name === name);
				} catch {
					registry = undefined;
				}

				if (!plugin && !registry) {
					throw new APIError(`Plugin not found: ${name}`, 404);
				}

				return c.json({ plugin, registry });
			} catch (error) {
				logger.error('Failed to get plugin detail', error);
				return errorJson(c, error);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/plugins/install',
			tags: ['plugins'],
			operationId: 'installPlugin',
			summary: 'Install a plugin into a scope',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: pluginInstallBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pluginMutationResponseSchema },
					},
				},
				'400': {
					description: 'Invalid request',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json();
				const parsed = pluginInstallBodySchema.parse(body);
				const plugin = await installPlugin(parsed.source, {
					scope: parsed.scope,
					projectRoot: getProjectRoot(parsed.project),
					enabled: parsed.enabled,
					...getRegistryOptions(parsed),
				});
				return c.json({ success: true, plugin });
			} catch (error) {
				logger.error('Failed to install plugin', error);
				return errorJson(c, error);
			}
		},
	);

	registerPluginMutation(app, {
		path: '/v1/plugins/remove',
		operationId: 'removePlugin',
		summary: 'Remove a plugin from a scope',
		handler: async ({ name, scope, project }) => {
			await removePlugin(name, { scope, projectRoot: getProjectRoot(project) });
			return undefined;
		},
	});
	registerPluginMutation(app, {
		path: '/v1/plugins/enable',
		operationId: 'enablePlugin',
		summary: 'Enable a plugin in a scope',
		handler: async ({ name, scope, project }) => {
			await setPluginEnabled(name, true, {
				scope,
				projectRoot: getProjectRoot(project),
			});
			return resolveMutationPlugin(name, scope, project);
		},
	});
	registerPluginMutation(app, {
		path: '/v1/plugins/disable',
		operationId: 'disablePlugin',
		summary: 'Disable a plugin in a scope',
		handler: async ({ name, scope, project }) => {
			await setPluginEnabled(name, false, {
				scope,
				projectRoot: getProjectRoot(project),
			});
			return resolveMutationPlugin(name, scope, project);
		},
	});

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/plugins/update',
			tags: ['plugins'],
			operationId: 'updatePlugin',
			summary: 'Update one plugin or all configured plugins in a scope',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: pluginUpdateBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pluginUpdateResponseSchema },
					},
				},
				'400': {
					description: 'Invalid request',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const parsed = pluginUpdateBodySchema.parse(await c.req.json());
				const scope = parsed.scope ?? 'global';
				const projectRoot = getProjectRoot(parsed.project);
				const options = {
					scope,
					projectRoot,
					...getRegistryOptions(parsed),
				};

				if (parsed.name) {
					const plugin = await updatePlugin(parsed.name, options);
					return c.json({ success: true, plugin });
				}

				const config = await loadPluginsConfig(scope, projectRoot);
				const plugins = [];
				for (const name of Object.keys(config.plugins).sort()) {
					plugins.push(await updatePlugin(name, options));
				}
				return c.json({ success: true, plugins });
			} catch (error) {
				logger.error('Failed to update plugins', error);
				return errorJson(c, error);
			}
		},
	);
}

function registerPluginMutation(
	app: Hono,
	options: {
		path: string;
		operationId: string;
		summary: string;
		handler: (input: {
			name: string;
			scope?: PluginScope;
			project?: string;
		}) => Promise<unknown>;
	},
) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: options.path,
			tags: ['plugins'],
			operationId: options.operationId,
			summary: options.summary,
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: pluginMutationBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pluginMutationResponseSchema },
					},
				},
				'400': {
					description: 'Invalid request',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const parsed = pluginMutationBodySchema.parse(await c.req.json());
				const plugin = await options.handler(parsed);
				return c.json({
					success: true,
					...(plugin && typeof plugin === 'object' ? { plugin } : {}),
				});
			} catch (error) {
				logger.error(`Failed plugin mutation ${options.operationId}`, error);
				return errorJson(c, error);
			}
		},
	);
}

async function resolveMutationPlugin(
	name: string,
	scope: PluginScope | undefined,
	project: string | undefined,
) {
	const effective = await resolveEffectivePlugins(getProjectRoot(project));
	return effective.plugins.find(
		(plugin) => plugin.name === name && (!scope || plugin.scope === scope),
	);
}
