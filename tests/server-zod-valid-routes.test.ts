import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createStandaloneApp } from '@ottocode/server';

const routesRoot = join(import.meta.dir, '../packages/server/src/routes');

const intentionalManualRequestEdges: Record<string, string> = {
	'attachments.ts': 'multipart upload and binary attachment download',
	'dictation/helpers.ts': 'WebSocket request helper',
	'dictation/sessions.ts': 'WebSocket ticket creation and binding',
	'dictation/websocket.ts': 'WebSocket upgrade',
	'files/handlers.ts': 'raw binary file response',
	'project-context.ts':
		'cross-route project header/query resolution middleware',
	'project-events.ts': 'SSE event stream',
	'session-messages.ts': 'text and binary artifact response boundaries',
	'session-stream.ts': 'SSE session stream',
	'terminals.ts': 'WebSocket ticket creation',
	'terminals/service.ts': 'WebSocket and SSE terminal streams',
	'tunnel/service.ts': 'shared header/query fallback used by tunnel SSE routes',
};

async function listTypeScriptFiles(
	directory: string,
	prefix = '',
): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relativePath = join(prefix, entry.name);
		if (entry.isDirectory()) {
			files.push(
				...(await listTypeScriptFiles(
					join(directory, entry.name),
					relativePath,
				)),
			);
		} else if (entry.name.endsWith('.ts')) {
			files.push(relativePath);
		}
	}
	return files;
}

function hasManualRequestRead(source: string): boolean {
	return (
		/c\.req\.json(?:<[^;]+?>)?\s*\(/s.test(source) ||
		/c\.req\.(?:query|param)\s*\(/.test(source) ||
		/\.parse\(\s*(?:await\s+)?c\.req\./s.test(source)
	);
}

describe('Zod-first server routes', () => {
	test('keeps manual request reads confined to documented transport edges', async () => {
		const files = await listTypeScriptFiles(routesRoot);
		const manualFiles: string[] = [];
		for (const file of files) {
			const source = await Bun.file(join(routesRoot, file)).text();
			if (hasManualRequestRead(source)) manualFiles.push(file);
		}

		expect(manualFiles.sort()).toEqual(
			Object.keys(intentionalManualRequestEdges).sort(),
		);
		for (const reason of Object.values(intentionalManualRequestEdges)) {
			expect(reason.length).toBeGreaterThan(0);
		}
	});

	test.each([
		['project JSON', '/v1/projects/open', 'POST', '{}'],
		['session query', '/v1/sessions?limit=invalid', 'GET', undefined],
		['auth JSON', '/v1/auth/copilot/device/poll', 'POST', '{}'],
		['git JSON', '/v1/git/rebase', 'POST', '{}'],
		['simulator JSON', '/v1/simulator/rotate', 'POST', '{}'],
	] as const)(
		'rejects invalid %s before domain handling',
		async (_, url, method, body) => {
			const app = createStandaloneApp();
			const response = await app.request(url, {
				method,
				headers: body ? { 'content-type': 'application/json' } : undefined,
				body,
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: { code: 'invalid_request', status: 400 },
			});
		},
	);
});
