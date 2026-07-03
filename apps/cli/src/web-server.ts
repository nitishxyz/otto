/**
 * Embedded Web UI Server
 * Serves the web UI from embedded assets
 */

import { webAssetPaths, assetPaths, getEmbeddedAsset } from './web-assets';
import { logger } from '@ottocode/sdk';

const decoder = new TextDecoder();

// MIME types
const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
};

function getMimeType(path: string): string {
	const ext = path.substring(path.lastIndexOf('.'));
	return MIME_TYPES[ext] || 'application/octet-stream';
}

export interface WebServerContext {
	projectId?: string;
	projectRoot?: string;
	serverToken?: string | null;
}

function injectRuntimeContext(
	html: string,
	serverUrl: string,
	context?: WebServerContext,
): string {
	const runtime = {
		serverUrl,
		projectId: context?.projectId,
		projectRoot: context?.projectRoot,
		serverToken: context?.serverToken,
	};
	return html.replace(
		'</head>',
		`<script>window.OTTO_SERVER_URL = ${JSON.stringify(serverUrl)};window.OTTO_RUNTIME_CONTEXT = ${JSON.stringify(runtime)};</script></head>`,
	);
}

/**
 * Create the web UI server
 */
export function createWebServer(
	port: number,
	agiServerPortOrUrl: number | string,
	network = false,
	context?: WebServerContext,
): { port: number; server: ReturnType<typeof Bun.serve> } {
	// Build asset map - maps URL paths to file paths
	const assetMap = new Map<string, string>();

	// Map root and index.html to the HTML file
	assetMap.set('/', webAssetPaths.html);
	assetMap.set('/index.html', webAssetPaths.html);

	// Map JS files
	assetPaths.assets.js.forEach((urlPath, index) => {
		assetMap.set(urlPath, webAssetPaths.js[index]);
	});

	// Map CSS files
	assetPaths.assets.css.forEach((urlPath, index) => {
		assetMap.set(urlPath, webAssetPaths.css[index]);
	});

	// Map other assets
	assetPaths.assets.other.forEach((urlPath, index) => {
		assetMap.set(urlPath, webAssetPaths.other[index]);
	});

	// Get the appropriate server URL for network mode
	const getServerUrl = (requestHost?: string) => {
		if (typeof agiServerPortOrUrl === 'string') {
			return agiServerPortOrUrl;
		}
		if (network && requestHost) {
			const hostname = requestHost.split(':')[0];
			return `http://${hostname}:${agiServerPortOrUrl}`;
		}
		return `http://127.0.0.1:${agiServerPortOrUrl}`;
	};

	const server = Bun.serve({
		port,
		hostname: network ? '0.0.0.0' : '127.0.0.1',

		async fetch(req) {
			const url = new URL(req.url);
			let pathname = url.pathname;

			const respondWithIndex = async () => {
				const indexPath = assetMap.get('/index.html');
				const serverUrl = getServerUrl(url.host);

				if (indexPath) {
					const indexFile = Bun.file(indexPath);
					if (await indexFile.exists()) {
						try {
							let html = await indexFile.text();
							html = injectRuntimeContext(html, serverUrl, context);
							return new Response(html, {
								headers: {
									'Content-Type': 'text/html; charset=utf-8',
									'Cache-Control': 'no-cache',
								},
							});
						} catch (error) {
							logger.error('Error reading HTML file for fallback', error);
						}
					}
				}

				const embeddedIndex = await getEmbeddedAsset('/index.html');
				if (embeddedIndex) {
					let html = decoder.decode(embeddedIndex);
					html = injectRuntimeContext(html, serverUrl, context);
					return new Response(html, {
						headers: {
							'Content-Type': 'text/html; charset=utf-8',
							'Cache-Control': 'no-cache',
						},
					});
				}

				return null;
			};

			// Normalize path
			if (pathname === '/') {
				pathname = '/index.html';
			}

			// Check if we have this asset
			if (assetMap.has(pathname)) {
				const filePath = assetMap.get(pathname);
				if (!filePath) {
					return new Response('Not Found', { status: 404 });
				}

				const file = Bun.file(filePath);
				const fileExists = await file.exists();

				if (fileExists) {
					if (pathname.endsWith('.html')) {
						try {
							let html = await file.text();
							const serverUrl = getServerUrl(url.host);
							html = injectRuntimeContext(html, serverUrl, context);

							return new Response(html, {
								headers: {
									'Content-Type': 'text/html; charset=utf-8',
									'Cache-Control': 'no-cache',
								},
							});
						} catch (error) {
							logger.error('Error reading HTML file', error);
						}
					}

					return new Response(file, {
						headers: {
							'Content-Type': getMimeType(pathname),
							'Cache-Control': 'public, max-age=31536000',
						},
					});
				}

				const embeddedData = await getEmbeddedAsset(pathname);
				if (embeddedData) {
					if (pathname.endsWith('.html')) {
						let html = decoder.decode(embeddedData);
						const serverUrl = getServerUrl(url.host);
						html = injectRuntimeContext(html, serverUrl, context);

						return new Response(html, {
							headers: {
								'Content-Type': 'text/html; charset=utf-8',
								'Cache-Control': 'no-cache',
							},
						});
					}

					return new Response(embeddedData, {
						headers: {
							'Content-Type': getMimeType(pathname),
							'Cache-Control': 'public, max-age=31536000',
						},
					});
				}
			}

			if (!pathname.includes('.')) {
				const fallback = await respondWithIndex();
				if (fallback) {
					return fallback;
				}
			}

			console.warn(`File not found: ${pathname}`);
			return new Response('Not Found', { status: 404 });
		},
	});

	return { port: Number(server.port ?? port), server };
}
