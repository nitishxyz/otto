import { z } from '@hono/zod-openapi';
import {
	buildFsTools,
	buildGitTools,
	getConfiguredProviderApiKey,
	getConfiguredProviderEnvVar,
	getConfiguredProviderIds,
	getGlobalAgentsJsonPath,
	getGlobalCommandsDir,
	getGlobalToolsDir,
	getSecureAuthPath,
	isProviderAuthorized,
	logger,
	readConfig,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { readdir } from 'node:fs/promises';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';

async function fileExists(path: string | null): Promise<boolean> {
	if (!path) return false;
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

async function readJsonSafe<T>(path: string | null): Promise<T | null> {
	if (!path) return null;
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return null;
		return (await file.json()) as T;
	} catch {
		return null;
	}
}

async function listDir(dir: string | null): Promise<string[]> {
	if (!dir) return [];
	try {
		return await readdir(dir);
	} catch {
		return [];
	}
}

const doctorQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const doctorResponseSchema = z.object({
	providers: z.array(
		z.object({
			id: z.string(),
			ok: z.boolean(),
			configured: z.boolean(),
			sources: z.array(z.string()),
		}),
	),
	defaults: z.object({
		agent: z.string(),
		provider: z.string(),
		model: z.string(),
		providerAuthorized: z.boolean(),
	}),
	agents: z.object({
		globalPath: z.string().nullable(),
		localPath: z.string().nullable(),
		globalNames: z.array(z.string()),
		localNames: z.array(z.string()),
	}),
	tools: z.object({
		defaultNames: z.array(z.string()),
		globalPath: z.string().nullable().optional(),
		globalNames: z.array(z.string()),
		localPath: z.string().nullable().optional(),
		localNames: z.array(z.string()),
		effectiveNames: z.array(z.string()),
	}),
	commands: z.object({
		globalPath: z.string().nullable().optional(),
		globalNames: z.array(z.string()),
		localPath: z.string().nullable().optional(),
		localNames: z.array(z.string()),
	}),
	issues: z.array(z.string()),
	suggestions: z.array(z.string()),
	globalAuthPath: z.string().nullable().optional(),
});

const doctorErrorSchema = z.object({
	error: z.string(),
});

export function registerDoctorRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/doctor',
			tags: ['config'],
			operationId: 'runDoctor',
			summary: 'Run diagnostics on the current configuration',
			request: {
				query: doctorQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: doctorResponseSchema },
					},
				},
				'500': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: doctorErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const { cfg, auth } = await readConfig(projectRoot);
				const configuredProviders = getConfiguredProviderIds(cfg, {
					includeDisabled: true,
				});

				const providers = await Promise.all(
					configuredProviders.map(async (id) => {
						const ok = await isProviderAuthorized(cfg, id);
						const envVar = getConfiguredProviderEnvVar(cfg, id) ?? null;
						const envConfigured = envVar ? !!process.env[envVar] : false;

						const globalAuthPath = getSecureAuthPath();
						let hasGlobalAuth = false;
						if (globalAuthPath) {
							const contents =
								await readJsonSafe<Record<string, unknown>>(globalAuthPath);
							hasGlobalAuth = Boolean(contents?.[id]);
						}

						const authInfo = auth?.[id];
						const hasStoredSecret = (() => {
							if (!authInfo) return false;
							if (authInfo.type === 'api')
								return Boolean((authInfo as { key?: string }).key);
							if (authInfo.type === 'wallet')
								return Boolean((authInfo as { secret?: string }).secret);
							if (authInfo.type === 'oauth')
								return Boolean(
									(authInfo as { access?: string; refresh?: string }).access ||
										(authInfo as { access?: string; refresh?: string }).refresh,
								);
							return false;
						})();

						const sources: string[] = [];
						if (envConfigured && envVar) sources.push(`env:${envVar}`);
						if (hasGlobalAuth) sources.push('auth.json');

						const configured =
							envConfigured ||
							hasGlobalAuth ||
							cfg.defaults.provider === id ||
							hasStoredSecret ||
							Boolean(getConfiguredProviderApiKey(cfg, id));

						return { id, ok, configured, sources };
					}),
				);

				const defaults = {
					agent: cfg.defaults.agent,
					provider: cfg.defaults.provider,
					model: cfg.defaults.model,
					providerAuthorized: await isProviderAuthorized(
						cfg,
						cfg.defaults.provider,
					),
				};

				const globalAgentsPath = getGlobalAgentsJsonPath();
				const localAgentsPath = `${projectRoot}/.otto/agents.json`;
				const globalAgents =
					(await readJsonSafe<Record<string, unknown>>(globalAgentsPath)) ?? {};
				const localAgents =
					(await readJsonSafe<Record<string, unknown>>(localAgentsPath)) ?? {};

				const agents = {
					globalPath: (await fileExists(globalAgentsPath))
						? globalAgentsPath
						: null,
					localPath: (await fileExists(localAgentsPath))
						? localAgentsPath
						: null,
					globalNames: Object.keys(globalAgents).sort(),
					localNames: Object.keys(localAgents).sort(),
				};

				const defaultToolNames = Array.from(
					new Set([
						...buildFsTools(projectRoot).map((t) => t.name),
						...buildGitTools(projectRoot).map((t) => t.name),
						'finish',
					]),
				).sort();

				const globalToolsDir = getGlobalToolsDir();
				const localToolsDir = `${projectRoot}/.otto/tools`;
				const globalToolNames = await listDir(globalToolsDir);
				const localToolNames = await listDir(localToolsDir);

				const tools = {
					defaultNames: defaultToolNames,
					globalPath: globalToolNames.length ? globalToolsDir : null,
					globalNames: globalToolNames.sort(),
					localPath: localToolNames.length ? localToolsDir : null,
					localNames: localToolNames.sort(),
					effectiveNames: Array.from(
						new Set([
							...defaultToolNames,
							...globalToolNames,
							...localToolNames,
						]),
					).sort(),
				};

				const globalCommandsDir = getGlobalCommandsDir();
				const localCommandsDir = `${projectRoot}/.otto/commands`;
				const globalCommandFiles = await listDir(globalCommandsDir);
				const localCommandFiles = await listDir(localCommandsDir);

				const commands = {
					globalPath: globalCommandFiles.length ? globalCommandsDir : null,
					globalNames: globalCommandFiles
						.filter((f) => f.endsWith('.json'))
						.map((f) => f.replace(/\.json$/, ''))
						.sort(),
					localPath: localCommandFiles.length ? localCommandsDir : null,
					localNames: localCommandFiles
						.filter((f) => f.endsWith('.json'))
						.map((f) => f.replace(/\.json$/, ''))
						.sort(),
				};

				const issues: string[] = [];
				if (!defaults.providerAuthorized) {
					issues.push(
						`Default provider '${defaults.provider}' is not authorized`,
					);
				}
				for (const [scope, entries] of [
					['global', globalAgents],
					['local', localAgents],
				] as const) {
					for (const [name, entry] of Object.entries(entries)) {
						if (entry && typeof entry === 'object') {
							const tools = (entry as { tools?: unknown }).tools;
							if (
								Object.hasOwn(entry, 'tools') &&
								(!tools || typeof tools !== 'object' || Array.isArray(tools))
							) {
								issues.push(
									`${scope}:${name} tools field must be an object with firstClass/loadable arrays`,
								);
							}
						}
					}
				}

				const suggestions: string[] = [];
				if (!defaults.providerAuthorized) {
					suggestions.push(
						`Run: otto auth login ${defaults.provider} — or switch defaults with: otto models`,
					);
				}
				if (issues.length) {
					suggestions.push('Review agents.json fields.');
				}

				return c.json({
					providers,
					defaults,
					agents,
					tools,
					commands,
					issues,
					suggestions,
					globalAuthPath: getSecureAuthPath(),
				});
			} catch (error) {
				logger.error('Failed to run doctor', error);
				const errorResponse = serializeError(error);
				return c.json(
					errorResponse,
					(errorResponse.error.status || 500) as 500,
				);
			}
		},
	);
}
