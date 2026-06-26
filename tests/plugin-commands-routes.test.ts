import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
	getProjectPluginsDir,
	TerminalManager,
	writePluginsConfig,
} from '@ottocode/sdk';
import { registerPluginsRoutes } from '../packages/server/src/routes/plugins/index.ts';

describe('plugin command routes', () => {
	let projectRoot: string;
	let previousXdgConfigHome: string | undefined;

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-plugin-command-routes-'));
		previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
	});

	afterEach(async () => {
		if (previousXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		}
		await rm(projectRoot, { recursive: true, force: true });
	});

	test('lists enabled plugin commands for autocomplete', async () => {
		await installProjectPlugin(projectRoot, {
			name: 'serve-sim',
			previewUrl: 'http://localhost:3200',
			commands: {
				start: {
					label: 'Start serve-sim',
					description: 'Start the preview server.',
					command: 'echo',
					args: ['start'],
					parameters: {
						port: { type: 'string', default: '3200' },
					},
				},
			},
		});
		await installProjectPlugin(projectRoot, {
			name: 'hidden-plugin',
			enabled: false,
			commands: {
				start: { command: 'echo', args: ['hidden'] },
			},
		});

		const app = createPluginsApp();
		const response = await app.request(
			`/v1/plugins/commands?project=${encodeURIComponent(projectRoot)}`,
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.commands).toEqual([
			expect.objectContaining({
				plugin: 'serve-sim',
				command: 'start',
				label: 'Start serve-sim',
				previewUrl: 'http://localhost:3200',
			}),
		]);
	});

	test('returns 404 for missing plugin commands', async () => {
		const app = createPluginsApp();
		const response = await app.request(
			`/v1/plugins/missing/commands/start/run?project=${encodeURIComponent(projectRoot)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: projectRoot }),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error.code).toBe('plugin_command_not_found');
	});

	test('returns 400 for invalid plugin command args', async () => {
		await installProjectPlugin(projectRoot, {
			name: 'serve-sim',
			commands: {
				start: {
					command: 'echo',
					args: ['{port}'],
					parameters: {
						port: { type: 'string', required: true },
					},
				},
			},
		});

		const app = createPluginsApp();
		const response = await app.request(
			'/v1/plugins/serve-sim/commands/start/run',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: projectRoot }),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error.code).toBe('plugin_command_invalid_args');
	});

	test('returns 503 when terminal bridge is unavailable', async () => {
		await installProjectPlugin(projectRoot, {
			name: 'serve-sim',
			commands: {
				doctor: { command: 'echo', args: ['ok'] },
			},
		});

		const app = createPluginsApp(undefined);
		const response = await app.request(
			'/v1/plugins/serve-sim/commands/doctor/run',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: projectRoot }),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body.error.code).toBe('plugin_command_terminal_unavailable');
		expect(body.error.details?.command).toBe('echo ok');
	});

	test('runs plugin commands through the server terminal bridge', async () => {
		await installProjectPlugin(projectRoot, {
			name: 'serve-sim',
			previewUrl: 'http://localhost:3200',
			commands: {
				doctor: {
					label: 'Check simulator dependencies',
					command: 'echo',
					args: ['plugin-route-ok'],
				},
			},
		});

		const app = createPluginsApp(new TerminalManager());
		const response = await app.request(
			'/v1/plugins/serve-sim/commands/doctor/run',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					project: projectRoot,
					argsText: '',
				}),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			command: 'echo plugin-route-ok',
			terminalId: expect.stringMatching(/^term-/),
			title: 'Check simulator dependencies',
			previewUrl: 'http://localhost:3200',
			execution: 'started',
		});
	});
});

function createPluginsApp(
	terminalManager?: import('@ottocode/sdk').TerminalManager,
) {
	const app = new OpenAPIHono();
	registerPluginsRoutes(app, terminalManager);
	return app;
}

async function installProjectPlugin(
	projectRoot: string,
	options: {
		name: string;
		enabled?: boolean;
		previewUrl?: string;
		commands: Record<string, unknown>;
	},
) {
	const pluginDir = join(getProjectPluginsDir(projectRoot), options.name);
	await mkdir(pluginDir, { recursive: true });
	await writeFile(
		join(pluginDir, 'otto.plugin.json'),
		`${JSON.stringify(
			{
				name: options.name,
				version: '1.0.0',
				commands: options.commands,
				browser: options.previewUrl
					? { previewUrl: options.previewUrl }
					: undefined,
			},
			null,
			2,
		)}\n`,
	);
	await writePluginsConfig(
		'project',
		{
			version: 1,
			registries: [],
			plugins: {
				[options.name]: { enabled: options.enabled ?? true },
			},
		},
		projectRoot,
	);
}
