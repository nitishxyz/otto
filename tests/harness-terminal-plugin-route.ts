import assert from 'node:assert/strict';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerPluginsRoutes } from '../packages/server/src/routes/plugins/index.ts';
import { getProjectManager } from '../packages/server/src/runtime/projects/manager.ts';

const projectRoot = process.argv[2];
assert(projectRoot, 'Expected an isolated project directory');
const manager = getProjectManager();

try {
	const app = new OpenAPIHono();
	registerPluginsRoutes(app);
	const response = await app.request(
		'/v1/plugins/serve-sim/commands/doctor/run',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: projectRoot, argsText: '' }),
		},
	);
	const body = await response.json();
	assert.equal(response.status, 200);
	const runtime = await manager.getProject({ path: projectRoot });
	const terminal = runtime.terminalManager.get(body.terminalId);
	assert(terminal, 'Route must create a real terminal');
	const deadline = Date.now() + 2000;
	while (terminal.status !== 'exited' && Date.now() < deadline) {
		await Bun.sleep(10);
	}
	assert.equal(terminal.status, 'exited', 'Plugin command must finish');
	console.log(
		JSON.stringify({
			status: response.status,
			body,
			output: terminal.read().join('\n'),
			exitCode: terminal.exitCode,
		}),
	);
} finally {
	await manager.closeAllProjects();
}
