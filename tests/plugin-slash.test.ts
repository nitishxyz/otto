import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
	TerminalManager,
	getProjectPluginsDir,
	writePluginsConfig,
} from '@ottocode/sdk';
import { tryExecutePluginSlashMessage } from '../packages/server/src/runtime/commands/plugin-slash.ts';
import { prepareBuiltinCommand } from '../packages/server/src/runtime/commands/builtins.ts';
import { prepareRecipeCommand } from '../packages/server/src/runtime/commands/recipes.ts';
import { registerSessionMessagesRoutes } from '../packages/server/src/routes/session-messages.ts';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';

describe('plugin slash parsing and precedence', () => {
	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-plugin-slash-'));
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		return {
			projectRoot,
			cleanup: async () => {
				await rm(projectRoot, { recursive: true, force: true });
			},
		};
	}

	async function installPlugin(
		projectRoot: string,
		name: string,
		commands: Record<string, unknown>,
	) {
		const pluginDir = join(getProjectPluginsDir(projectRoot), name);
		await mkdir(pluginDir, { recursive: true });
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			`${JSON.stringify({ name, version: '1.0.0', commands }, null, 2)}\n`,
		);
		await writePluginsConfig(
			'project',
			{ version: 1, registries: [], plugins: { [name]: { enabled: true } } },
			projectRoot,
		);
	}

	it('prefers built-in /init over plugin namespaces', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, 'init', {
				start: { command: 'echo', args: ['plugin-init'] },
			});

			const result = await tryExecutePluginSlashMessage({
				projectRoot,
				content: '/init',
				terminalManager: new TerminalManager(),
			});
			expect(result).toBeNull();
		} finally {
			await cleanup();
		}
	});

	it('prefers recipes over plugin namespaces with the same first token', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const recipesDir = join(projectRoot, '.otto', 'recipes');
			await mkdir(recipesDir, { recursive: true });
			await writeFile(
				join(recipesDir, 'serve-sim.md'),
				['---', 'description: Recipe wins', '---', '', 'Run recipe.'].join(
					'\n',
				),
			);
			await installPlugin(projectRoot, 'serve-sim', {
				start: { command: 'echo', args: ['plugin'] },
			});

			const pluginResult = await tryExecutePluginSlashMessage({
				projectRoot,
				content: '/serve-sim start',
				terminalManager: new TerminalManager(),
			});
			expect(pluginResult).toBeNull();

			const recipe = await prepareRecipeCommand({
				projectRoot,
				content: '/serve-sim start',
			});
			expect(recipe?.name).toBe('serve-sim');
		} finally {
			await cleanup();
		}
	});

	it('runs plugin namespace commands when no recipe matches', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, 'serve-sim', {
				doctor: {
					label: 'Check simulator dependencies',
					command: 'echo',
					args: ['plugin-slash-ok'],
				},
			});

			const result = await tryExecutePluginSlashMessage({
				projectRoot,
				content: '/serve-sim doctor',
				terminalManager: new TerminalManager(),
			});
			expect(result).toEqual({
				command: 'echo plugin-slash-ok',
				terminalId: expect.stringMatching(/^term-/),
				title: 'Check simulator dependencies',
				execution: 'started',
			});
		} finally {
			await cleanup();
		}
	});

	it('does not run plugin commands when a recipe shares the namespace', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const recipesDir = join(projectRoot, '.otto', 'recipes');
			await mkdir(recipesDir, { recursive: true });
			await writeFile(
				join(recipesDir, 'serve-sim.md'),
				['---', '---', '', 'Recipe body.'].join('\n'),
			);
			await installPlugin(projectRoot, 'serve-sim', {
				doctor: { command: 'echo', args: ['escape'] },
			});

			const result = await tryExecutePluginSlashMessage({
				projectRoot,
				content: '/serve-sim doctor',
				terminalManager: new TerminalManager(),
			});
			expect(result).toBeNull();
		} finally {
			await cleanup();
		}
	});

	it('returns null for plugin namespace without a command name', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, 'serve-sim', {
				start: { command: 'echo', args: ['ok'] },
			});

			expect(
				await tryExecutePluginSlashMessage({
					projectRoot,
					content: '/serve-sim',
					terminalManager: new TerminalManager(),
				}),
			).toBeNull();
		} finally {
			await cleanup();
		}
	});
});

describe('session message plugin slash execution', () => {
	it('returns pluginCommand payload instead of enqueueing assistant work', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'otto-plugin-slash-route-'),
		);
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		try {
			const pluginDir = join(getProjectPluginsDir(projectRoot), 'serve-sim');
			await mkdir(pluginDir, { recursive: true });
			await writeFile(
				join(pluginDir, 'otto.plugin.json'),
				`${JSON.stringify(
					{
						name: 'serve-sim',
						version: '1.0.0',
						commands: {
							doctor: { command: 'echo', args: ['from-session-message'] },
						},
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
					plugins: { 'serve-sim': { enabled: true } },
				},
				projectRoot,
			);

			const db = await getDb(projectRoot);
			const now = Date.now();
			const sessionId = 'plugin-slash-session';
			await db.insert(sessions).values({
				id: sessionId,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4.1',
				projectPath: projectRoot,
				createdAt: now,
				lastActiveAt: now,
			});

			const app = new OpenAPIHono();
			registerSessionMessagesRoutes(app, new TerminalManager());
			const response = await app.request(
				`/v1/sessions/${sessionId}/messages?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ content: '/serve-sim doctor' }),
				},
			);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.pluginCommand).toEqual({
				command: 'echo from-session-message',
				terminalId: expect.stringMatching(/^term-/),
				title: 'serve-sim doctor',
				execution: 'started',
			});
			expect(body.messageId).toBeUndefined();

			const builtin = await prepareBuiltinCommand({
				cfg: { projectRoot, defaults: {} } as never,
				db,
				sessionId,
				provider: 'openai',
				model: 'gpt-4.1',
				content: '/serve-sim doctor',
			});
			expect(builtin).toBeNull();
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
