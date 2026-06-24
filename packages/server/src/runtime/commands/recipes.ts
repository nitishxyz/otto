import { extractFrontmatter } from '@ottocode/sdk';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { discoverAllAgents, resolveAgentConfig } from '../agent/registry.ts';

const RECIPE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_RECIPE_AGENT = 'build';

export type RecipeInvocation = {
	name: string;
	args: string;
};

export type ProjectRecipe = {
	name: string;
	description?: string;
	agent: string;
	path: string;
	content: string;
	instructions: string;
};

export function getProjectRecipesDir(projectRoot: string): string {
	return join(projectRoot, '.otto', 'recipes');
}

export function isValidRecipeName(name: string): boolean {
	return RECIPE_NAME_PATTERN.test(name);
}

export function parseRecipeInvocation(
	content: string,
): RecipeInvocation | null {
	const trimmed = content.trim();
	if (!trimmed.startsWith('/')) return null;

	const withoutSlash = trimmed.slice(1);
	const spaceIdx = withoutSlash.search(/\s/);
	const rawName =
		spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
	const name = rawName.toLowerCase();
	if (!isValidRecipeName(name)) return null;

	return {
		name,
		args: spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1).trim(),
	};
}

export async function loadProjectRecipe(
	projectRoot: string,
	name: string,
): Promise<ProjectRecipe | null> {
	if (!isValidRecipeName(name)) return null;

	const recipePath = join(getProjectRecipesDir(projectRoot), `${name}.md`);
	let content: string;
	try {
		content = (await readFile(recipePath, 'utf8')).replace(/\r\n?/g, '\n');
	} catch {
		return null;
	}

	const { agent, description, instructions } = parseRecipeContent(content);
	if (!instructions.trim()) return null;

	return {
		name,
		agent,
		description,
		path: recipePath,
		content,
		instructions,
	};
}

export async function discoverProjectRecipes(
	projectRoot: string,
): Promise<ProjectRecipe[]> {
	const recipesDir = getProjectRecipesDir(projectRoot);
	let entries: string[];
	try {
		entries = await readdir(recipesDir);
	} catch {
		return [];
	}

	const recipes: ProjectRecipe[] = [];
	for (const entry of entries) {
		if (!entry.endsWith('.md')) continue;
		const name = basename(entry, '.md').toLowerCase();
		if (!isValidRecipeName(name)) continue;
		const recipe = await loadProjectRecipe(projectRoot, name);
		if (recipe) recipes.push(recipe);
	}

	return recipes.sort((a, b) => a.name.localeCompare(b.name));
}

export async function prepareRecipeCommand(args: {
	projectRoot: string;
	content: string;
}): Promise<{
	name: string;
	description?: string;
	agent: string;
	provider?: string;
	model?: string;
	prompt: string;
} | null> {
	const invocation = parseRecipeInvocation(args.content);
	if (!invocation) return null;

	const recipe = await loadProjectRecipe(args.projectRoot, invocation.name);
	if (!recipe) return null;

	const agent = await resolveRecipeAgent(args.projectRoot, recipe.agent);
	const agentConfig = await resolveAgentConfig(args.projectRoot, agent);

	return {
		name: recipe.name,
		description: recipe.description,
		agent,
		provider: agentConfig.provider,
		model: agentConfig.model,
		prompt: buildRecipePrompt(args.projectRoot, recipe, invocation.args),
	};
}

export function parseRecipeContent(content: string): {
	agent: string;
	description?: string;
	instructions: string;
} {
	const parsed = extractFrontmatter(content);
	if (!parsed) {
		return { agent: DEFAULT_RECIPE_AGENT, instructions: content.trim() };
	}

	return {
		agent:
			readFrontmatterString(parsed.frontmatter, 'agent') ??
			DEFAULT_RECIPE_AGENT,
		description: readFrontmatterString(parsed.frontmatter, 'description'),
		instructions: parsed.body.trim(),
	};
}

async function resolveRecipeAgent(
	projectRoot: string,
	agent: string,
): Promise<string> {
	const requested = agent.trim() || DEFAULT_RECIPE_AGENT;
	try {
		const available = await discoverAllAgents(projectRoot);
		return available.includes(requested) ? requested : DEFAULT_RECIPE_AGENT;
	} catch {
		return DEFAULT_RECIPE_AGENT;
	}
}

function readFrontmatterString(
	frontmatter: string,
	key: string,
): string | undefined {
	for (const line of frontmatter.split('\n')) {
		const match = line.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'i'));
		if (!match) continue;
		const value = (match[1] ?? '').trim();
		if (!value) return undefined;
		return value.replace(/^['"]|['"]$/g, '');
	}
	return undefined;
}

function buildRecipePrompt(
	projectRoot: string,
	recipe: ProjectRecipe,
	args: string,
): string {
	const displayPath = relative(projectRoot, recipe.path) || recipe.path;
	const parts = [
		`Run the project recipe /${recipe.name}.`,
		recipe.description ? `Description: ${recipe.description}` : undefined,
		`Recipe file: ${displayPath}`,
		[
			'<recipe-instructions>',
			recipe.instructions,
			'</recipe-instructions>',
		].join('\n'),
		args
			? ['<recipe-arguments>', args, '</recipe-arguments>'].join('\n')
			: undefined,
		'This recipe is a reusable project instruction. Execute it through the normal agent flow and respect all normal tool approval, editing, and safety rules.',
	];

	return parts.filter(Boolean).join('\n\n');
}
