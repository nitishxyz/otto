import { describe, expect, it } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';
import {
	getGlobalRecipesDir,
	getProjectPluginsDir,
	writePluginsConfig,
} from '@ottocode/sdk';
import {
	discoverAllRecipes,
	discoverProjectRecipes,
	parseRecipeInvocation,
	prepareRecipeCommand,
	resolveInvokableRecipe,
	validateRecipeNameForScope,
} from '../packages/server/src/runtime/commands/recipes.ts';

describe('project recipes', () => {
	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-recipes-'));
		const recipesDir = join(projectRoot, '.otto', 'recipes');
		await mkdir(recipesDir, { recursive: true });
		return {
			projectRoot,
			recipesDir,
			cleanup: () => rm(projectRoot, { recursive: true, force: true }),
		};
	}

	it('parses slash recipe invocations with arguments', () => {
		expect(parseRecipeInvocation('/publish-ready web cli')).toEqual({
			name: 'publish-ready',
			args: 'web cli',
		});
		expect(parseRecipeInvocation('publish-ready')).toBeNull();
		expect(parseRecipeInvocation('/Bad_Name')).toBeNull();
	});

	it('discovers markdown recipes with frontmatter descriptions', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await writeFile(
				join(recipesDir, 'publish-ready.md'),
				[
					'---',
					'description: Set publish flags',
					'---',
					'',
					'Update publish.env.',
				].join('\n'),
			);
			await writeFile(join(recipesDir, 'Invalid_Name.md'), 'Ignore me');

			const recipes = await discoverProjectRecipes(projectRoot);
			expect(recipes.map((recipe) => recipe.name)).toEqual(['publish-ready']);
			expect(recipes[0]?.scope).toBe('project');
			expect(recipes[0]?.agent).toBe('build');
			expect(recipes[0]?.includeInHistory).toBe(true);
			expect(recipes[0]?.description).toBe('Set publish flags');
			expect(recipes[0]?.instructions).toBe('Update publish.env.');
		} finally {
			await cleanup();
		}
	});

	it('renders recipe command prompts with arguments', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await writeFile(
				join(recipesDir, 'publish-ready.md'),
				[
					'---',
					'description: Set publish flags',
					'---',
					'',
					'Update publish.env and run bun lint.',
				].join('\n'),
			);

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/publish-ready web',
			});
			expect(command?.name).toBe('publish-ready');
			expect(command?.includeInHistory).toBe(true);
			expect(command?.prompt).toContain(
				'Run the project recipe /publish-ready.',
			);
			expect(command?.prompt).toContain(
				'Recipe file: .otto/recipes/publish-ready.md',
			);
			expect(command?.prompt).toContain('Update publish.env and run bun lint.');
			expect(command?.prompt).toContain(
				'<recipe-arguments>\nweb\n</recipe-arguments>',
			);
		} finally {
			await cleanup();
		}
	});

	it('uses configured recipe agent when available', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await writeFile(
				join(projectRoot, '.otto', 'agents.json'),
				JSON.stringify({
					composer: {
						provider: 'openai',
						model: 'gpt-4.1',
					},
				}),
			);
			await mkdir(join(projectRoot, '.otto', 'agents'), { recursive: true });
			await writeFile(
				join(projectRoot, '.otto', 'agents', 'composer.md'),
				'Compose.',
			);
			await writeFile(
				join(recipesDir, 'publish-ready.md'),
				[
					'---',
					'description: Set publish flags',
					'agent: composer',
					'---',
					'',
					'Update publish.env and run bun lint.',
				].join('\n'),
			);

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/publish-ready',
			});
			expect(command?.agent).toBe('composer');
			expect(command?.provider).toBe('openai');
			expect(command?.model).toBe('gpt-4.1');
		} finally {
			await cleanup();
		}
	});

	it('falls back to build agent when recipe agent is unavailable', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await writeFile(
				join(recipesDir, 'publish-ready.md'),
				[
					'---',
					'description: Set publish flags',
					'agent: missing-agent',
					'---',
					'',
					'Update publish.env and run bun lint.',
				].join('\n'),
			);

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/publish-ready',
			});
			expect(command?.agent).toBe('build');
		} finally {
			await cleanup();
		}
	});

	it('omits recipe invocations and replies from history when configured', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await writeFile(
				join(recipesDir, 'publish-ready.md'),
				[
					'---',
					'description: Set publish flags',
					'includeInHistory: false',
					'---',
					'',
					'Update publish.env and run bun lint.',
				].join('\n'),
			);

			const db = await getDb(projectRoot);
			const now = Date.now();
			await db.insert(sessions).values({
				id: 'recipe-history-session',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4.1',
				projectPath: projectRoot,
				createdAt: now,
				lastActiveAt: now,
			});

			const rows = [
				{ id: 'user-before', role: 'user', text: 'normal request' },
				{ id: 'assistant-before', role: 'assistant', text: 'normal reply' },
				{ id: 'user-recipe', role: 'user', text: '/publish-ready web' },
				{ id: 'assistant-recipe', role: 'assistant', text: 'recipe reply' },
				{ id: 'user-after', role: 'user', text: 'after recipe' },
			];
			for (let index = 0; index < rows.length; index++) {
				const row = rows[index];
				await db.insert(messages).values({
					id: row.id,
					sessionId: 'recipe-history-session',
					role: row.role,
					status: 'complete',
					agent: 'build',
					provider: 'openai',
					model: 'gpt-4.1',
					createdAt: now + index,
				});
				await db.insert(messageParts).values({
					id: `${row.id}-part`,
					messageId: row.id,
					index: 0,
					type: 'text',
					content: JSON.stringify({ text: row.text }),
					agent: 'build',
					provider: 'openai',
					model: 'gpt-4.1',
				});
			}

			const history = await buildHistoryMessages(
				db,
				'recipe-history-session',
				undefined,
				{ projectRoot },
			);
			const serialized = JSON.stringify(history);
			expect(serialized).toContain('normal request');
			expect(serialized).toContain('normal reply');
			expect(serialized).toContain('after recipe');
			expect(serialized).not.toContain('/publish-ready');
			expect(serialized).not.toContain('recipe reply');
		} finally {
			await cleanup();
		}
	});

	it('keeps recipe invocations and replies in history when configured', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await writeFile(
				join(recipesDir, 'refactor-thing.md'),
				[
					'---',
					'description: Refactor a specific area',
					'includeInHistory: true',
					'---',
					'',
					'Refactor the requested area.',
				].join('\n'),
			);

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/refactor-thing auth',
			});
			expect(command?.includeInHistory).toBe(true);

			const db = await getDb(projectRoot);
			const now = Date.now();
			await db.insert(sessions).values({
				id: 'recipe-include-history-session',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4.1',
				projectPath: projectRoot,
				createdAt: now,
				lastActiveAt: now,
			});

			const rows = [
				{ id: 'user-recipe', role: 'user', text: '/refactor-thing auth' },
				{ id: 'assistant-recipe', role: 'assistant', text: 'refactor reply' },
			];
			for (let index = 0; index < rows.length; index++) {
				const row = rows[index];
				await db.insert(messages).values({
					id: row.id,
					sessionId: 'recipe-include-history-session',
					role: row.role,
					status: 'complete',
					agent: 'build',
					provider: 'openai',
					model: 'gpt-4.1',
					createdAt: now + index,
				});
				await db.insert(messageParts).values({
					id: `${row.id}-part`,
					messageId: row.id,
					index: 0,
					type: 'text',
					content: JSON.stringify({ text: row.text }),
					agent: 'build',
					provider: 'openai',
					model: 'gpt-4.1',
				});
			}

			const history = await buildHistoryMessages(
				db,
				'recipe-include-history-session',
				undefined,
				{ projectRoot },
			);
			const serialized = JSON.stringify(history);
			expect(serialized).toContain('/refactor-thing auth');
			expect(serialized).toContain('refactor reply');
		} finally {
			await cleanup();
		}
	});
});

describe('global and scoped recipes', () => {
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-recipes-'));
		const recipesDir = join(projectRoot, '.otto', 'recipes');
		await mkdir(recipesDir, { recursive: true });
		return {
			projectRoot,
			recipesDir,
			cleanup: async () => {
				await rm(projectRoot, { recursive: true, force: true });
				if (originalXdgConfigHome === undefined) {
					delete process.env.XDG_CONFIG_HOME;
				} else {
					process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
				}
			},
		};
	}

	async function setupGlobalRecipesDir() {
		const xdgConfigHome = await mkdtemp(join(tmpdir(), 'otto-xdg-'));
		process.env.XDG_CONFIG_HOME = xdgConfigHome;
		const globalRecipesDir = getGlobalRecipesDir();
		await mkdir(globalRecipesDir, { recursive: true });
		return globalRecipesDir;
	}

	it('discovers global recipes from the global config recipes dir', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const globalRecipesDir = await setupGlobalRecipesDir();
			await writeFile(
				join(globalRecipesDir, 'ship-it.md'),
				['---', 'description: Ship', '---', '', 'Run release checks.'].join(
					'\n',
				),
			);

			const recipes = await discoverAllRecipes(projectRoot);
			expect(recipes.map((recipe) => [recipe.scope, recipe.name])).toEqual([
				['global', 'ship-it'],
			]);
		} finally {
			await cleanup();
		}
	});

	it('lists project and global recipes together with scope metadata', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			const globalRecipesDir = await setupGlobalRecipesDir();
			await writeFile(
				join(recipesDir, 'project-only.md'),
				['---', 'description: Project', '---', '', 'Project task.'].join('\n'),
			);
			await writeFile(
				join(globalRecipesDir, 'global-only.md'),
				['---', 'description: Global', '---', '', 'Global task.'].join('\n'),
			);

			const recipes = await discoverAllRecipes(projectRoot);
			expect(recipes.map((recipe) => [recipe.scope, recipe.name])).toEqual([
				['global', 'global-only'],
				['project', 'project-only'],
			]);
		} finally {
			await cleanup();
		}
	});

	it('invokes a global recipe when no project recipe exists', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const globalRecipesDir = await setupGlobalRecipesDir();
			await writeFile(
				join(globalRecipesDir, 'global-ship.md'),
				[
					'---',
					'description: Global ship',
					'---',
					'',
					'Ship from global recipe.',
				].join('\n'),
			);

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/global-ship',
			});
			expect(command?.name).toBe('global-ship');
			expect(command?.prompt).toContain('Run the global recipe /global-ship.');
		} finally {
			await cleanup();
		}
	});

	it('rejects creating a recipe named like a built-in slash command', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await setupGlobalRecipesDir();
			const validation = await validateRecipeNameForScope({
				projectRoot,
				scope: 'project',
				name: 'compact',
			});
			expect(validation).toEqual({
				ok: false,
				status: 409,
				message: 'Recipe name is reserved',
			});
		} finally {
			await cleanup();
		}
	});

	it('rejects duplicate recipe names across project and global scopes', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			const globalRecipesDir = await setupGlobalRecipesDir();
			await writeFile(
				join(recipesDir, 'shared-name.md'),
				['---', 'description: Project', '---', '', 'Project task.'].join('\n'),
			);

			const validation = await validateRecipeNameForScope({
				projectRoot,
				scope: 'global',
				name: 'shared-name',
			});
			expect(validation.ok).toBe(false);
			if (!validation.ok) {
				expect(validation.status).toBe(409);
				expect(validation.message).toContain('project recipes');
			}

			await writeFile(
				join(globalRecipesDir, 'other-global.md'),
				['---', 'description: Global', '---', '', 'Global task.'].join('\n'),
			);
			const reverseValidation = await validateRecipeNameForScope({
				projectRoot,
				scope: 'project',
				name: 'other-global',
			});
			expect(reverseValidation.ok).toBe(false);
		} finally {
			await cleanup();
		}
	});

	it('does not invoke conflicted duplicate recipes', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			const globalRecipesDir = await setupGlobalRecipesDir();
			const body = ['---', 'description: Dup', '---', '', 'Dup task.'].join(
				'\n',
			);
			await writeFile(join(recipesDir, 'dup-name.md'), body);
			await writeFile(join(globalRecipesDir, 'dup-name.md'), body);

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/dup-name',
			});
			expect(command).toBeNull();

			const recipes = await discoverAllRecipes(projectRoot);
			expect(
				recipes.filter((recipe) => recipe.name === 'dup-name').length,
			).toBe(2);
			expect(
				recipes
					.filter((recipe) => recipe.name === 'dup-name')
					.every((recipe) => recipe.conflict?.reason === 'duplicate'),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it('applies includeInHistory false for global recipes', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const globalRecipesDir = await setupGlobalRecipesDir();
			await writeFile(
				join(globalRecipesDir, 'quiet-global.md'),
				[
					'---',
					'description: Quiet global',
					'includeInHistory: false',
					'---',
					'',
					'Run quietly.',
				].join('\n'),
			);

			const db = await getDb(projectRoot);
			const now = Date.now();
			await db.insert(sessions).values({
				id: 'global-recipe-history-session',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4.1',
				projectPath: projectRoot,
				createdAt: now,
				lastActiveAt: now,
			});

			const rows = [
				{ id: 'user-recipe', role: 'user', text: '/quiet-global' },
				{ id: 'assistant-recipe', role: 'assistant', text: 'global reply' },
			];
			for (let index = 0; index < rows.length; index++) {
				const row = rows[index];
				await db.insert(messages).values({
					id: row.id,
					sessionId: 'global-recipe-history-session',
					role: row.role,
					status: 'complete',
					agent: 'build',
					provider: 'openai',
					model: 'gpt-4.1',
					createdAt: now + index,
				});
				await db.insert(messageParts).values({
					id: `${row.id}-part`,
					messageId: row.id,
					index: 0,
					type: 'text',
					content: JSON.stringify({ text: row.text }),
					agent: 'build',
					provider: 'openai',
					model: 'gpt-4.1',
				});
			}

			const history = await buildHistoryMessages(
				db,
				'global-recipe-history-session',
				undefined,
				{ projectRoot },
			);
			const serialized = JSON.stringify(history);
			expect(serialized).not.toContain('/quiet-global');
			expect(serialized).not.toContain('global reply');
		} finally {
			await cleanup();
		}
	});
});

describe('plugin recipes', () => {
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-recipes-plugin-'));
		const recipesDir = join(projectRoot, '.otto', 'recipes');
		await mkdir(recipesDir, { recursive: true });
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		return {
			projectRoot,
			recipesDir,
			cleanup: async () => {
				await rm(projectRoot, { recursive: true, force: true });
				if (originalXdgConfigHome === undefined) {
					delete process.env.XDG_CONFIG_HOME;
				} else {
					process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
				}
			},
		};
	}

	async function installProjectPlugin(
		projectRoot: string,
		options: {
			name: string;
			enabled?: boolean;
			recipes?: Array<{ name: string; path: string; description?: string }>;
		},
	) {
		const pluginDir = join(getProjectPluginsDir(projectRoot), options.name);
		await mkdir(join(pluginDir, 'recipes'), { recursive: true });
		for (const recipe of options.recipes ?? []) {
			await writeFile(
				join(pluginDir, recipe.path),
				[
					'---',
					recipe.description ? `description: ${recipe.description}` : undefined,
					'---',
					'',
					`Run ${recipe.name} from plugin.`,
				]
					.filter(Boolean)
					.join('\n'),
			);
		}
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			`${JSON.stringify(
				{
					name: options.name,
					version: '1.0.0',
					recipes: options.recipes,
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

	it('discovers enabled plugin recipes', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installProjectPlugin(projectRoot, {
				name: 'recipe-plugin',
				recipes: [
					{
						name: 'plugin-ship',
						path: 'recipes/plugin-ship.md',
						description: 'Ship from plugin',
					},
				],
			});

			const recipes = await discoverAllRecipes(projectRoot);
			expect(recipes).toEqual([
				expect.objectContaining({
					name: 'plugin-ship',
					scope: 'project',
					description: 'Ship from plugin',
				}),
			]);
		} finally {
			await cleanup();
		}
	});

	it('invokes plugin recipes through prepareRecipeCommand', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installProjectPlugin(projectRoot, {
				name: 'recipe-plugin',
				recipes: [
					{
						name: 'plugin-ship',
						path: 'recipes/plugin-ship.md',
						description: 'Ship from plugin',
					},
				],
			});

			const command = await prepareRecipeCommand({
				projectRoot,
				content: '/plugin-ship ios',
			});
			expect(command?.name).toBe('plugin-ship');
			expect(command?.prompt).toContain('Run the project recipe /plugin-ship.');
			expect(command?.prompt).toContain('Run plugin-ship from plugin.');
		} finally {
			await cleanup();
		}
	});

	it('marks duplicate plugin and file recipes as conflicted and not invokable', async () => {
		const { projectRoot, recipesDir, cleanup } = await setupProject();
		try {
			await installProjectPlugin(projectRoot, {
				name: 'recipe-plugin',
				recipes: [
					{
						name: 'shared-recipe',
						path: 'recipes/shared-recipe.md',
					},
				],
			});
			await writeFile(
				join(recipesDir, 'shared-recipe.md'),
				['---', 'description: File recipe', '---', '', 'File body.'].join('\n'),
			);

			const recipes = await discoverAllRecipes(projectRoot);
			const matches = recipes.filter(
				(recipe) => recipe.name === 'shared-recipe',
			);
			expect(matches).toHaveLength(2);
			expect(
				matches.every((recipe) => recipe.conflict?.reason === 'duplicate'),
			).toBe(true);
			expect(
				await resolveInvokableRecipe(projectRoot, 'shared-recipe'),
			).toBeNull();
			expect(
				await prepareRecipeCommand({
					projectRoot,
					content: '/shared-recipe',
				}),
			).toBeNull();
		} finally {
			await cleanup();
		}
	});

	it('ignores disabled plugin recipes', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installProjectPlugin(projectRoot, {
				name: 'recipe-plugin',
				enabled: false,
				recipes: [
					{
						name: 'hidden-recipe',
						path: 'recipes/hidden-recipe.md',
					},
				],
			});

			const recipes = await discoverAllRecipes(projectRoot);
			expect(recipes).toHaveLength(0);
			expect(
				await resolveInvokableRecipe(projectRoot, 'hidden-recipe'),
			).toBeNull();
		} finally {
			await cleanup();
		}
	});

	it('rejects creating a file recipe that conflicts with a plugin recipe', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installProjectPlugin(projectRoot, {
				name: 'recipe-plugin',
				recipes: [
					{
						name: 'plugin-only',
						path: 'recipes/plugin-only.md',
					},
				],
			});

			const validation = await validateRecipeNameForScope({
				projectRoot,
				scope: 'project',
				name: 'plugin-only',
			});
			expect(validation.ok).toBe(false);
		} finally {
			await cleanup();
		}
	});
});
