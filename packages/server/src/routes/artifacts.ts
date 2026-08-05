import { extname } from 'node:path';
import { resolveArtifactBuildAsset } from '@ottocode/sdk';
import type { Context, Hono } from 'hono';
import { getProjectManager } from '../runtime/projects/manager.ts';
import { resolveRequestProjectRoot } from './project-context.ts';

const CONTENT_TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

const ARTIFACT_CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"media-src 'self' blob:",
	"connect-src 'none'",
	"frame-src 'none'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

function responseHeaders(path: string): Record<string, string> {
	return {
		'Cache-Control': 'private, max-age=31536000, immutable',
		'Content-Security-Policy': ARTIFACT_CSP,
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

async function serveArtifactAsset(c: Context, projectRoot: string) {
	try {
		const assetPath = await resolveArtifactBuildAsset(
			projectRoot,
			c.req.param('artifactId'),
			c.req.param('revisionId'),
			requestedAssetPath(c),
		);
		return new Response(Bun.file(assetPath), {
			headers: responseHeaders(assetPath),
		});
	} catch {
		return c.json({ error: 'Artifact revision not found' }, 404);
	}
}

function redirectToDirectory(c: Context) {
	const url = new URL(c.req.url);
	url.pathname = `${url.pathname}/`;
	return c.redirect(url.toString(), 308);
}

/** Serves immutable compiled Artifact revisions from project-local cache storage. */
export function registerArtifactRoutes(app: Hono) {
	app.get(
		'/v1/artifacts/projects/:projectId/:artifactId/revisions/:revisionId',
		redirectToDirectory,
	);
	app.get(
		'/v1/artifacts/projects/:projectId/:artifactId/revisions/:revisionId/*',
		async (c) => {
			const projectId = c.req.param('projectId');
			const pinnedProjectId = c.req.header('X-Otto-Share-Project-Id');
			if (pinnedProjectId && pinnedProjectId !== projectId) {
				return c.json({ error: 'Artifact project access denied' }, 403);
			}
			try {
				const runtime = await getProjectManager().getProject({ id: projectId });
				return serveArtifactAsset(c, runtime.root);
			} catch {
				return c.json({ error: 'Artifact revision not found' }, 404);
			}
		},
	);

	app.get(
		'/v1/artifacts/:artifactId/revisions/:revisionId',
		redirectToDirectory,
	);
	app.get('/v1/artifacts/:artifactId/revisions/:revisionId/*', async (c) => {
		return serveArtifactAsset(c, await resolveRequestProjectRoot(c));
	});
}
