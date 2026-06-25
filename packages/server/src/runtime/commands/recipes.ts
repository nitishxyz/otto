import { extractFrontmatter, getGlobalRecipesDir } from '@ottocode/sdk';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { discoverAllAgents, resolveAgentConfig } from '../agent/registry.ts';
import { isReservedRecipeSlashCommandName } from './reserved-slash-commands.ts';

const RECIPE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_RECIPE_AGENT = 'build';

export type RecipeScope = 'project' | 'global';

export type RecipeConflict = {
	reason: 'reserved' | 'duplicate';
	scopes?: RecipeScope[];
};

export type RecipeInvocation = {
	name: string;
	args: string;
};

export type Recipe = {
	name: string;
	scope: RecipeScope;
	description?: string;
	agent: string;
	includeInHistory: boolean;
	path: string;
	content: string;
	instructions: string;
	conflict?: RecipeConflict;
};

/** @deprecated Use {@link Recipe} with scope `project`. */
export type ProjectRecipe = Recipe;

export function getProjectRecipesDir(projectRoot: string): string {
	return join(projectRoot, '.otto', 'recipes');
}

export function getRecipesDir(scope: RecipeScope, projectRoot: string): string {
	return scope === 'global'
		? getGlobalRecipesDir()
		: getProjectRecipesDir(projectRoot);
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

export type RecipeNameValidationResult =
	| { ok: true }
	| { ok: false; status: 400 | 409; message: string };

export async function validateRecipeNameForScope(args: {
	projectRoot: string;
	scope: RecipeScope;
	name: string;
}): Promise<RecipeNameValidationResult> {
	const name = args.name.toLowerCase();
	if (!isValidRecipeName(name)) {
		return { ok: false, status: 400, message: 'Invalid recipe name' };
	}
	if (isReservedRecipeSlashCommandName(name)) {
		return { ok: false, status: 409, message: 'Recipe name is reserved' };
	}

	const oppositeScope: RecipeScope =
		args.scope === 'project' ? 'global' : 'project';
	const duplicate = await loadRecipe({
		projectRoot: args.projectRoot,
		scope: oppositeScope,
		name,
	});
	if (duplicate) {
		return {
			ok: false,
			status: 409,
			message: `Recipe name already exists in ${oppositeScope} recipes`,
		};
	}

	return { ok: true };
}

function buildRecipeConflict(args: {
	name: string;
	scope: RecipeScope;
	projectNames: Set<string>;
	globalNames: Set<string>;
}): RecipeConflict | undefined {
	if (isReservedRecipeSlashCommandName(args.name)) {
		return { reason: 'reserved' };
	}
	if (args.projectNames.has(args.name) && args.globalNames.has(args.name)) {
		return { reason: 'duplicate', scopes: ['project', 'global'] };
	}
	return undefined;
}

export async function loadRecipe(args: {
	projectRoot: string;
	scope: RecipeScope;
	name: string;
}): Promise<Recipe | null> {
	const name = args.name.toLowerCase();
	if (!isValidRecipeName(name)) return null;

	const recipePath = join(
		getRecipesDir(args.scope, args.projectRoot),
		`${name}.md`,
	);
	let content: string;
	try {
		content = (await readFile(recipePath, 'utf8')).replace(/\r\n?/g, '\n');
	} catch {
		return null;
	}

	const { agent, description, includeInHistory, instructions } =
		parseRecipeContent(content);
	if (!instructions.trim()) return null;

	return {
		name,
		scope: args.scope,
		agent,
		description,
		includeInHistory,
		path: recipePath,
		content,
		instructions,
	};
}

export async function discoverRecipes(args: {
	projectRoot: string;
	scope: RecipeScope;
}): Promise<Recipe[]> {
	const recipesDir = getRecipesDir(args.scope, args.projectRoot);
	let entries: string[];
	try {
		entries = await readdir(recipesDir);
	} catch {
		return [];
	}

	const recipes: Recipe[] = [];
	for (const entry of entries) {
		if (!entry.endsWith('.md')) continue;
		const name = basename(entry, '.md').toLowerCase();
		if (!isValidRecipeName(name)) continue;
		const recipe = await loadRecipe({
			projectRoot: args.projectRoot,
			scope: args.scope,
			name,
		});
		if (recipe) recipes.push(recipe);
	}

	return recipes.sort((a, b) => a.name.localeCompare(b.name));
}

export async function discoverAllRecipes(
	projectRoot: string,
): Promise<Recipe[]> {
	const [projectRecipes, globalRecipes] = await Promise.all([
		discoverRecipes({ projectRoot, scope: 'project' }),
		discoverRecipes({ projectRoot, scope: 'global' }),
	]);
	const projectNames = new Set(projectRecipes.map((recipe) => recipe.name));
	const globalNames = new Set(globalRecipes.map((recipe) => recipe.name));

	const annotate = (recipe: Recipe): Recipe => {
		const conflict = buildRecipeConflict({
			name: recipe.name,
			scope: recipe.scope,
			projectNames,
			globalNames,
		});
		return conflict ? { ...recipe, conflict } : recipe;
	};

	return [...projectRecipes.map(annotate), ...globalRecipes.map(annotate)].sort(
		(a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
	);
}

export async function resolveInvokableRecipe(
	projectRoot: string,
	name: string,
): Promise<Recipe | null> {
	const normalized = name.toLowerCase();
	if (!isValidRecipeName(normalized)) return null;
	if (isReservedRecipeSlashCommandName(normalized)) return null;

	const [projectRecipe, globalRecipe] = await Promise.all([
		loadRecipe({ projectRoot, scope: 'project', name: normalized }),
		loadRecipe({ projectRoot, scope: 'global', name: normalized }),
	]);

	if (projectRecipe && globalRecipe) return null;
	return projectRecipe ?? globalRecipe;
}

export async function loadProjectRecipe(
	projectRoot: string,
	name: string,
): Promise<Recipe | null> {
	return loadRecipe({ projectRoot, scope: 'project', name });
}

export async function discoverProjectRecipes(
	projectRoot: string,
): Promise<Recipe[]> {
	return discoverRecipes({ projectRoot, scope: 'project' });
}

export async function prepareRecipeCommand(args: {
	projectRoot: string;
	content: string;
}): Promise<{
	name: string;
	description?: string;
	agent: string;
	includeInHistory: boolean;
	provider?: string;
	model?: string;
	prompt: string;
} | null> {
	const invocation = parseRecipeInvocation(args.content);
	if (!invocation) return null;

	const recipe = await resolveInvokableRecipe(
		args.projectRoot,
		invocation.name,
	);
	if (!recipe) return null;

	const agent = await resolveRecipeAgent(args.projectRoot, recipe.agent);
	const agentConfig = await resolveAgentConfig(args.projectRoot, agent);

	return {
		name: recipe.name,
		description: recipe.description,
		agent,
		includeInHistory: recipe.includeInHistory,
		provider: agentConfig.provider,
		model: agentConfig.model,
		prompt: buildRecipePrompt(args.projectRoot, recipe, invocation.args),
	};
}

export function parseRecipeContent(content: string): {
	agent: string;
	description?: string;
	includeInHistory: boolean;
	instructions: string;
} {
	const parsed = extractFrontmatter(content);
	if (!parsed) {
		return {
			agent: DEFAULT_RECIPE_AGENT,
			includeInHistory: true,
			instructions: content.trim(),
		};
	}

	return {
		agent:
			readFrontmatterString(parsed.frontmatter, 'agent') ??
			DEFAULT_RECIPE_AGENT,
		description: readFrontmatterString(parsed.frontmatter, 'description'),
		includeInHistory:
			readFrontmatterBoolean(parsed.frontmatter, 'includeInHistory') ?? true,
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

function readFrontmatterBoolean(
	frontmatter: string,
	key: string,
): boolean | undefined {
	const value = readFrontmatterString(frontmatter, key)?.toLowerCase();
	if (value === 'true' || value === 'yes' || value === '1') return true;
	if (value === 'false' || value === 'no' || value === '0') return false;
	return undefined;
}

function buildRecipePrompt(
	projectRoot: string,
	recipe: Recipe,
	args: string,
): string {
	const displayPath = relative(projectRoot, recipe.path) || recipe.path;
	const scopeLabel = recipe.scope === 'global' ? 'global' : 'project';
	const parts = [
		`Run the ${scopeLabel} recipe /${recipe.name}.`,
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
		`This recipe is a reusable ${scopeLabel} instruction. Execute it through the normal agent flow and respect all normal tool approval, editing, and safety rules.`,
	];

	return parts.filter(Boolean).join('\n\n');
}
