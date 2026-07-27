import { z } from '@hono/zod-openapi';
import { getOttoHomeDir } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { listProjectDirectories } from '../runtime/projects/filesystem.ts';
import { getProjectManager } from '../runtime/projects/manager.ts';
import { stopProjectTunnel } from './tunnel/service.ts';

const projectSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	path: z.string(),
	stateDir: z.string(),
	dbPath: z.string(),
	openedAt: z.number().optional(),
	lastUsedAt: z.number(),
	open: z.boolean(),
	pinned: z.boolean(),
});

const projectListResponseSchema = z.object({
	projects: z.array(projectSummarySchema),
});

const openProjectBodySchema = z.object({
	path: z.string().min(1),
});

const projectDirectoriesQuerySchema = z.object({
	path: z.string().min(1).optional(),
});

const projectDirectoriesResponseSchema = z.object({
	path: z.string(),
	parent: z.string().nullable(),
	directories: z.array(z.object({ name: z.string(), path: z.string() })),
	truncated: z.boolean(),
});

const projectIdParamsSchema = z.object({
	projectId: z.string().openapi({
		param: { name: 'projectId', in: 'path' },
		description: 'Stable otto project id',
	}),
});

const projectActionResponseSchema = z.object({ ok: z.boolean() });
const projectPinnedBodySchema = z.object({ pinned: z.boolean() });
const projectErrorSchema = z.object({ error: z.string() });

async function openProjectSummary(path: string) {
	const runtime = await getProjectManager().openProject({ path });
	const project = getProjectManager()
		.listOpenProjects()
		.find((item) => item.id === runtime.id);
	if (!project) throw new Error('Project failed to open');
	return project;
}

export function registerProjectsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/projects',
			tags: ['projects'],
			operationId: 'listProjects',
			summary: 'List open and known projects',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectListResponseSchema },
					},
				},
			},
		},
		async (c) => {
			return c.json({ projects: await getProjectManager().listProjects() });
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/projects/open',
			tags: ['projects'],
			operationId: 'openProject',
			summary: 'Open a project runtime',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: openProjectBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectSummarySchema },
					},
				},
			},
		},
		async (c) => {
			const body = openProjectBodySchema.parse(await c.req.json());
			return c.json(await openProjectSummary(body.path));
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/projects/directories',
			tags: ['projects'],
			operationId: 'listProjectDirectories',
			summary: 'Browse host directories for project selection',
			request: { query: projectDirectoriesQuerySchema },
			responses: {
				'200': {
					description: 'Host directory listing',
					content: {
						'application/json': { schema: projectDirectoriesResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const query = projectDirectoriesQuerySchema.parse({
				path: c.req.query('path'),
			});
			return c.json(await listProjectDirectories(query.path));
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/projects/general/open',
			tags: ['projects'],
			operationId: 'openGeneralProject',
			summary: 'Create and open the host General workspace',
			responses: {
				'200': {
					description: 'General project',
					content: {
						'application/json': { schema: projectSummarySchema },
					},
				},
			},
		},
		async (c) => {
			const path = join(getOttoHomeDir(), 'general');
			await mkdir(path, { recursive: true });
			return c.json(await openProjectSummary(path));
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/projects/{projectId}',
			tags: ['projects'],
			operationId: 'getProject',
			summary: 'Get a project runtime or known project',
			request: { params: projectIdParamsSchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectSummarySchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: projectErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const projectId = c.req.param('projectId');
			const project = (await getProjectManager().listProjects()).find(
				(item) => item.id === projectId,
			);
			return project
				? c.json(project)
				: c.json({ error: 'Project not found' }, 404);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/projects/{projectId}/pinned',
			tags: ['projects'],
			operationId: 'setProjectPinned',
			summary: 'Pin or unpin a known project',
			request: {
				params: projectIdParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: projectPinnedBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectActionResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: projectErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const body = projectPinnedBodySchema.parse(await c.req.json());
			const updated = await getProjectManager().setProjectPinned(
				c.req.param('projectId'),
				body.pinned,
			);
			return updated
				? c.json({ ok: true })
				: c.json({ error: 'Project not found' }, 404);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/projects/{projectId}',
			tags: ['projects'],
			operationId: 'forgetProject',
			summary: 'Forget a known project',
			request: { params: projectIdParamsSchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectActionResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: projectErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const project = await getProjectManager().forgetProject(
				c.req.param('projectId'),
			);
			return project
				? c.json({ ok: true })
				: c.json({ error: 'Project not found' }, 404);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/projects/{projectId}/close',
			tags: ['projects'],
			operationId: 'closeProject',
			summary: 'Close a project runtime',
			request: { params: projectIdParamsSchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectActionResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const projectId = c.req.param('projectId');
			stopProjectTunnel(projectId);
			await getProjectManager().closeProject(projectId);
			return c.json({ ok: true });
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/projects/{projectId}/touch',
			tags: ['projects'],
			operationId: 'touchProjectRuntime',
			summary: 'Update a project runtime last-used timestamp',
			request: { params: projectIdParamsSchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: projectActionResponseSchema },
					},
				},
			},
		},
		async (c) => {
			getProjectManager().touchProject(c.req.param('projectId'));
			return c.json({ ok: true });
		},
	);
}
