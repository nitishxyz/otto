import { describe, expect, it } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';
import {
	discoverProjectRecipes,
	parseRecipeInvocation,
	prepareRecipeCommand,
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
			expect(recipes[0]?.agent).toBe('build');
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

	it('omits prior recipe invocations and replies from future history', async () => {
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
});
