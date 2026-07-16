import { z } from '@hono/zod-openapi';
import {
	isSupportedGitReferenceUrl,
	loadConfig,
	logger,
	readReferenceSettings,
	removeReferenceSettings,
	writeReferenceSettings,
	type ReferenceConfig,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	deleteReferenceClone,
	getReferenceStatuses,
	prepareReferences,
	retryReferencePreparation,
} from '../../runtime/context/references.ts';
import { getProjectManager } from '../../runtime/projects/manager.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description: 'Project root override.',
		}),
});
const listScopeQuerySchema = projectQuerySchema.extend({
	scope: z
		.enum(['effective', 'global', 'local'])
		.optional()
		.default('effective'),
});
const scopeQuerySchema = projectQuerySchema.extend({
	scope: z.enum(['global', 'local']).optional().default('global'),
});
const directoryQuerySchema = projectQuerySchema.extend({
	path: z.string().optional(),
});
const nameParamSchema = z.object({
	name: z
		.string()
		.min(1)
		.openapi({ param: { name: 'name', in: 'path' } }),
});
const sourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('git'),
		url: z.string().min(1).refine(isSupportedGitReferenceUrl, {
			message: 'Git URL must use HTTP(S) or SSH',
		}),
		ref: z.string().optional(),
	}),
	z.object({ type: z.literal('local'), path: z.string().min(1) }),
]);
const referenceSchema = z.object({
	description: z.string().min(1),
	enabled: z.boolean().optional(),
	source: sourceSchema,
});
const referenceStatusSchema = z.object({
	status: z.enum(['cloning', 'available', 'error']),
	error: z.string().optional(),
	output: z.array(z.string()).optional(),
});
const referencesResponseSchema = z.object({
	references: z.record(z.string(), referenceSchema),
	statuses: z.record(z.string(), referenceStatusSchema),
});
const mutationResponseSchema = z.object({
	success: z.boolean(),
	references: z.record(z.string(), referenceSchema),
	statuses: z.record(z.string(), referenceStatusSchema),
});
const directoryListResponseSchema = z.object({
	path: z.string(),
	parent: z.string().nullable(),
	directories: z.array(z.object({ name: z.string(), path: z.string() })),
});

export function registerReferencesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/references',
			tags: ['config'],
			operationId: 'listReferences',
			summary: 'List configured references',
			request: { query: listScopeQuerySchema },
			responses: {
				'200': {
					description: 'Configured references',
					content: { 'application/json': { schema: referencesResponseSchema } },
				},
			},
		},
		async (c) => {
			const projectRoot = await resolveRequestProjectRoot(c);
			const requestedScope = c.req.query('scope');
			const scope =
				requestedScope === 'global' || requestedScope === 'local'
					? requestedScope
					: 'effective';
			const cfg = await loadConfig(projectRoot);
			const references =
				scope === 'effective'
					? (cfg.references ?? {})
					: await readReferenceSettings(scope, projectRoot);
			const scopedConfig = { ...cfg, references };
			prepareReferences(scopedConfig);
			return c.json({
				references,
				statuses: await getReferenceStatuses(scopedConfig),
			});
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/reference-directories',
			tags: ['config'],
			operationId: 'listReferenceDirectories',
			summary: 'Browse directories available to the Otto server',
			request: { query: directoryQuerySchema },
			responses: {
				'200': {
					description: 'Directory listing',
					content: {
						'application/json': { schema: directoryListResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const requestedPath = c.req.query('path')?.trim();
				const expandedPath = requestedPath?.startsWith('~/')
					? join(homedir(), requestedPath.slice(2))
					: requestedPath;
				const path = expandedPath
					? isAbsolute(expandedPath)
						? resolve(expandedPath)
						: resolve(projectRoot, expandedPath)
					: projectRoot;
				if (!(await stat(path)).isDirectory()) {
					return c.json({ error: 'Path is not a directory' }, 400);
				}
				const directories = (await readdir(path, { withFileTypes: true }))
					.filter((entry) => entry.isDirectory())
					.map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
					.sort((a, b) => a.name.localeCompare(b.name));
				const parent = dirname(path);
				return c.json({
					path,
					parent: parent === path ? null : parent,
					directories,
				});
			} catch (error) {
				logger.error('Failed to browse reference directories', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/references/{name}',
			tags: ['config'],
			operationId: 'upsertReference',
			summary: 'Create or update a reference',
			request: {
				params: nameParamSchema,
				query: scopeQuerySchema,
				body: {
					required: true,
					content: { 'application/json': { schema: referenceSchema } },
				},
			},
			responses: {
				'200': {
					description: 'Updated references',
					content: { 'application/json': { schema: mutationResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const { name } = c.req.param();
				const scope = c.req.query('scope') === 'local' ? 'local' : 'global';
				const reference = (await c.req.json()) as ReferenceConfig;
				await writeReferenceSettings(scope, name, reference, projectRoot);
				const cfg =
					(await getProjectManager().refreshProjectConfig(projectRoot)) ??
					(await loadConfig(projectRoot));
				prepareReferences({ ...cfg, references: { [name]: reference } });
				return c.json({
					success: true,
					references: cfg.references ?? {},
					statuses: await getReferenceStatuses(cfg),
				});
			} catch (error) {
				logger.error('Failed to update reference', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/config/references/{name}/retry',
			tags: ['config'],
			operationId: 'retryReference',
			summary: 'Retry cloning a Git reference',
			request: { params: nameParamSchema, query: projectQuerySchema },
			responses: {
				'200': {
					description: 'Reference clone retry started',
					content: { 'application/json': { schema: mutationResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const { name } = c.req.param();
				const cfg = await loadConfig(projectRoot);
				const reference = cfg.references?.[name];
				if (!reference) return c.json({ error: 'Reference not found' }, 404);
				if (reference.source.type !== 'git') {
					return c.json({ error: 'Only Git references can be retried' }, 400);
				}
				retryReferencePreparation(name, reference, cfg);
				return c.json({
					success: true,
					references: cfg.references ?? {},
					statuses: await getReferenceStatuses(cfg),
				});
			} catch (error) {
				logger.error('Failed to retry reference', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/config/references/{name}',
			tags: ['config'],
			operationId: 'deleteReference',
			summary: 'Delete a reference',
			request: { params: nameParamSchema, query: scopeQuerySchema },
			responses: {
				'200': {
					description: 'Updated references',
					content: { 'application/json': { schema: mutationResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const { name } = c.req.param();
				const scope = c.req.query('scope') === 'local' ? 'local' : 'global';
				const scopedReferences = await readReferenceSettings(
					scope,
					projectRoot,
				);
				const deletedReference = scopedReferences[name];
				await removeReferenceSettings(scope, name, projectRoot);
				const cfg =
					(await getProjectManager().refreshProjectConfig(projectRoot)) ??
					(await loadConfig(projectRoot));
				await deleteReferenceClone(name, deletedReference, cfg);
				return c.json({
					success: true,
					references: cfg.references ?? {},
					statuses: await getReferenceStatuses(cfg),
				});
			} catch (error) {
				logger.error('Failed to delete reference', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);
}
