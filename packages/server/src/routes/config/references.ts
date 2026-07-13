import { z } from '@hono/zod-openapi';
import {
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
		url: z.string().min(1),
		ref: z.string().optional(),
	}),
	z.object({ type: z.literal('local'), path: z.string().min(1) }),
]);
const referenceSchema = z.object({
	description: z.string().min(1),
	enabled: z.boolean().optional(),
	source: sourceSchema,
});
const referencesResponseSchema = z.object({
	references: z.record(z.string(), referenceSchema),
});
const mutationResponseSchema = z.object({
	success: z.boolean(),
	references: z.record(z.string(), referenceSchema),
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
			request: { query: scopeQuerySchema },
			responses: {
				'200': {
					description: 'Configured references',
					content: { 'application/json': { schema: referencesResponseSchema } },
				},
			},
		},
		async (c) => {
			const projectRoot = await resolveRequestProjectRoot(c);
			const scope = c.req.query('scope') === 'local' ? 'local' : 'global';
			const references = await readReferenceSettings(scope, projectRoot);
			return c.json({ references });
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
				return c.json({ success: true, references: cfg.references ?? {} });
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
				await removeReferenceSettings(scope, name, projectRoot);
				const cfg =
					(await getProjectManager().refreshProjectConfig(projectRoot)) ??
					(await loadConfig(projectRoot));
				return c.json({ success: true, references: cfg.references ?? {} });
			} catch (error) {
				logger.error('Failed to delete reference', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);
}
