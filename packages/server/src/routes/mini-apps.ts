import { extname } from 'node:path';
import { z } from '@hono/zod-openapi';
import {
	getGlobalAppsCacheDir,
	resolveMiniAppBuildAsset,
	resolveMiniAppBuildAssetInCache,
} from '@ottocode/sdk';
import type { Context, Hono } from 'hono';
import { getProjectManager } from '../runtime/projects/manager.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	buildInstalledMiniApp,
	listInstalledMiniApps,
} from '../runtime/mini-apps/service.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
	resolveRequestProjectRoot,
} from './project-context.ts';

const CONTENT_TYPES: Record<string, string> = {
	'.avif': 'image/avif',
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

const MINI_APP_CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"media-src 'self' blob:",
	"connect-src 'none'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

const miniAppScopeSchema = z.enum(['project', 'global']);
const miniAppSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	runtime: z.literal('otto-react'),
	scope: miniAppScopeSchema,
	entry: z.string(),
	revisionId: z.string(),
	permissions: z.array(z.string()),
	capabilities: z.array(z.string()),
	placements: z.array(z.enum(['apps', 'project', 'commandPalette'])),
});
const miniAppListResponseSchema = z.object({
	apps: z.array(miniAppSummarySchema),
	projectCount: z.number(),
	globalCount: z.number(),
});
const miniAppBuildResponseSchema = z.object({
	app: miniAppSummarySchema,
	previewPath: z.string(),
	cached: z.boolean(),
});
const miniAppErrorSchema = z.object({ error: z.string() });

function responseHeaders(path: string): Record<string, string> {
	return {
		'Cache-Control': 'private, max-age=31536000, immutable',
		'Content-Security-Policy': MINI_APP_CSP,
		'Content-Type':
			CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
		'Referrer-Policy': 'no-referrer',
		'X-Content-Type-Options': 'nosniff',
	};
}

function requestedAssetPath(c: Context): string {
	const pathname = new URL(c.req.url).pathname;
	const marker = `/revisions/${encodeURIComponent(c.req.param('revisionId'))}/`;
	const markerIndex = pathname.indexOf(marker);
	if (markerIndex < 0) return '';
	const encodedPath = pathname.slice(markerIndex + marker.length);
	try {
		return decodeURIComponent(encodedPath);
	} catch {
		return encodedPath;
	}
}

async function serveBuildAsset(c: Context, projectRoot: string) {
	try {
		const assetPath = await resolveMiniAppBuildAsset(
			projectRoot,
			c.req.param('appId'),
			c.req.param('revisionId'),
			requestedAssetPath(c),
		);
		return new Response(Bun.file(assetPath), {
			headers: responseHeaders(assetPath),
		});
	} catch {
		return c.json({ error: 'Mini App build asset not found' }, 404);
	}
}

function redirectToDirectory(c: Context) {
	const url = new URL(c.req.url);
	url.pathname = `${url.pathname}/`;
	return c.redirect(url.toString(), 308);
}

/** Serves immutable, compiled Mini App assets from project-local build storage. */
export function registerMiniAppRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/mini-apps',
			tags: ['mini-apps'],
			operationId: 'listMiniApps',
			summary: 'List project and global Mini Apps',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'Discovered Mini Apps',
					content: {
						'application/json': { schema: miniAppListResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const { projectRoot } = await resolveRequestProject(c);
			const apps = await listInstalledMiniApps(projectRoot);
			return c.json({
				apps,
				projectCount: apps.filter((item) => item.scope === 'project').length,
				globalCount: apps.filter((item) => item.scope === 'global').length,
			});
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mini-apps/{scope}/{appId}/build',
			tags: ['mini-apps'],
			operationId: 'buildMiniApp',
			summary: 'Build an installed Mini App for local preview',
			request: {
				params: z.object({
					scope: miniAppScopeSchema,
					appId: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
				}),
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'Built Mini App revision',
					content: {
						'application/json': { schema: miniAppBuildResponseSchema },
					},
				},
				'404': {
					description: 'Mini App not found',
					content: { 'application/json': { schema: miniAppErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const project = await resolveRequestProject(c);
				const scope = c.req.param('scope') as 'project' | 'global';
				const build = await buildInstalledMiniApp({
					projectId: project.projectId,
					projectRoot: project.projectRoot,
					scope,
					appId: c.req.param('appId'),
				});
				return c.json({
					app: {
						id: build.manifest.id,
						name: build.manifest.name,
						description: build.manifest.description,
						runtime: build.manifest.runtime,
						scope,
						entry: build.manifest.entry,
						revisionId: build.revisionId,
						permissions: build.manifest.permissions,
						capabilities: build.manifest.capabilities,
						placements: build.manifest.placements,
					},
					previewPath: build.previewPath,
					cached: build.cached,
				});
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : String(error) },
					404,
				);
			}
		},
	);

	app.get(
		'/v1/mini-apps/global/:appId/revisions/:revisionId',
		redirectToDirectory,
	);

	app.get('/v1/mini-apps/global/:appId/revisions/:revisionId/*', async (c) => {
		try {
			const assetPath = await resolveMiniAppBuildAssetInCache(
				getGlobalAppsCacheDir(),
				c.req.param('appId'),
				c.req.param('revisionId'),
				requestedAssetPath(c),
			);
			return new Response(Bun.file(assetPath), {
				headers: responseHeaders(assetPath),
			});
		} catch {
			return c.json({ error: 'Mini App build asset not found' }, 404);
		}
	});

	app.get(
		'/v1/mini-apps/projects/:projectId/:appId/revisions/:revisionId',
		redirectToDirectory,
	);

	app.get(
		'/v1/mini-apps/projects/:projectId/:appId/revisions/:revisionId/*',
		async (c) => {
			const projectId = c.req.param('projectId');
			const pinnedProjectId = c.req.header('X-Otto-Share-Project-Id');
			if (pinnedProjectId && pinnedProjectId !== projectId) {
				return c.json({ error: 'Mini App project access denied' }, 403);
			}
			try {
				const runtime = await getProjectManager().getProject({ id: projectId });
				return serveBuildAsset(c, runtime.root);
			} catch {
				return c.json({ error: 'Mini App build asset not found' }, 404);
			}
		},
	);

	app.get('/v1/mini-apps/:appId/revisions/:revisionId', redirectToDirectory);

	app.get('/v1/mini-apps/:appId/revisions/:revisionId/*', async (c) => {
		return serveBuildAsset(c, await resolveRequestProjectRoot(c));
	});
}
