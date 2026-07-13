import {
	extractFrontmatter,
	getGlobalRecipesDir,
	resolveEffectivePlugins,
} from '@ottocode/sdk';
import INIT_RECIPE from '@ottocode/sdk/prompts/recipes/init.md' with {
	type: 'text',
};
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
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
	oneShot: boolean;
	path: string;
	content: string;
	instructions: string;
	conflict?: RecipeConflict;
};

type BuiltinRecipe = Omit<Recipe, 'scope' | 'conflict'> & {
	scope: 'builtin';
};

type InvokableRecipe = Recipe | BuiltinRecipe;

const BUILTIN_RECIPE_SOURCES: Readonly<Record<string, string>> = {
	init: INIT_RECIPE,
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

	const targetPath = join(
		getRecipesDir(args.scope, args.projectRoot),
		`${name}.md`,
	);
	const existing = (await discoverAllRecipes(args.projectRoot)).filter(
		(recipe) => recipe.name === name,
	);
	const conflicting = existing.filter((recipe) => recipe.path !== targetPath);
	if (conflicting.length > 0) {
		const scopes = Array.from(
			new Set(conflicting.map((recipe) => recipe.scope)),
		).sort() as RecipeScope[];
		return {
			ok: false,
			status: 409,
			message:
				scopes.length === 1
					? `Recipe name already exists in ${scopes[0]} recipes`
					: `Recipe name already exists in ${scopes.join(' and ')} recipes`,
		};
	}

	return { ok: true };
}

function buildRecipeConflict(args: {
	name: string;
	scopes: RecipeScope[];
}): RecipeConflict | undefined {
	if (isReservedRecipeSlashCommandName(args.name)) {
		return { reason: 'reserved' };
	}
	const uniqueScopes = Array.from(new Set(args.scopes)).sort();
	if (uniqueScopes.length > 1) {
		return { reason: 'duplicate', scopes: uniqueScopes };
	}
	if (args.scopes.length > 1) {
		return { reason: 'duplicate', scopes: uniqueScopes };
	}
	return undefined;
}

function isPathInsidePluginDir(
	pluginDir: string,
	candidatePath: string,
): boolean {
	const resolvedPluginDir = resolve(pluginDir);
	const resolvedPath = resolve(candidatePath);
	return (
		resolvedPath === resolvedPluginDir ||
		resolvedPath.startsWith(`${resolvedPluginDir}/`)
	);
}

async function discoverPluginRecipes(projectRoot: string): Promise<Recipe[]> {
	let effectivePlugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>;
	try {
		effectivePlugins = await resolveEffectivePlugins(projectRoot);
	} catch {
		return [];
	}

	const recipes: Recipe[] = [];
	for (const plugin of effectivePlugins.plugins) {
		if (
			!plugin.enabled ||
			plugin.status !== 'installed' ||
			!plugin.manifest?.recipes?.length
		) {
			continue;
		}

		const scope: RecipeScope = plugin.scope;
		for (const pluginRecipe of plugin.manifest.recipes) {
			const name = pluginRecipe.name.toLowerCase();
			if (!isValidRecipeName(name)) continue;

			const recipePath = resolve(plugin.dir, pluginRecipe.path);
			if (!isPathInsidePluginDir(plugin.dir, recipePath)) continue;

			let content: string;
			try {
				content = (await readFile(recipePath, 'utf8')).replace(/\r\n?/g, '\n');
			} catch {
				continue;
			}

			const { agent, description, includeInHistory, oneShot, instructions } =
				parseRecipeContent(content);
			if (!instructions.trim()) continue;

			recipes.push({
				name,
				scope,
				agent,
				description: pluginRecipe.description ?? description,
				includeInHistory,
				oneShot,
				path: recipePath,
				content,
				instructions,
			});
		}
	}

	return recipes.sort(
		(a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
	);
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

	const { agent, description, includeInHistory, oneShot, instructions } =
		parseRecipeContent(content);
	if (!instructions.trim()) return null;

	return {
		name,
		scope: args.scope,
		agent,
		description,
		includeInHistory,
		oneShot,
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
	const [projectRecipes, globalRecipes, pluginRecipes] = await Promise.all([
		discoverRecipes({ projectRoot, scope: 'project' }),
		discoverRecipes({ projectRoot, scope: 'global' }),
		discoverPluginRecipes(projectRoot),
	]);

	const recipes = [...projectRecipes, ...globalRecipes, ...pluginRecipes];
	const scopesByName = new Map<string, RecipeScope[]>();
	for (const recipe of recipes) {
		const scopes = scopesByName.get(recipe.name) ?? [];
		scopes.push(recipe.scope);
		scopesByName.set(recipe.name, scopes);
	}

	const annotate = (recipe: Recipe): Recipe => {
		const scopes = scopesByName.get(recipe.name) ?? [recipe.scope];
		const conflict = buildRecipeConflict({
			name: recipe.name,
			scopes,
		});
		return conflict ? { ...recipe, conflict } : recipe;
	};

	return recipes
		.map(annotate)
		.sort(
			(a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
		);
}

export async function resolveInvokableRecipe(
	projectRoot: string,
	name: string,
): Promise<InvokableRecipe | null> {
	const normalized = name.toLowerCase();
	if (!isValidRecipeName(normalized)) return null;
	const builtin = loadBuiltinRecipe(normalized);
	if (builtin) return builtin;
	if (isReservedRecipeSlashCommandName(normalized)) return null;

	const matches = (await discoverAllRecipes(projectRoot)).filter(
		(recipe) => recipe.name === normalized && !recipe.conflict,
	);
	if (matches.length !== 1) return null;
	return matches[0] ?? null;
}

function loadBuiltinRecipe(name: string): BuiltinRecipe | null {
	const content = BUILTIN_RECIPE_SOURCES[name];
	if (!content) return null;
	const { agent, description, includeInHistory, oneShot, instructions } =
		parseRecipeContent(content);
	if (!instructions.trim()) return null;

	return {
		name,
		scope: 'builtin',
		agent,
		description,
		includeInHistory,
		oneShot,
		path: `@ottocode/sdk/prompts/recipes/${name}.md`,
		content,
		instructions,
	};
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
	oneShot: boolean;
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
		oneShot: recipe.oneShot,
		provider: agentConfig.provider,
		model: agentConfig.model,
		prompt: buildRecipePrompt(args.projectRoot, recipe, invocation.args),
	};
}

export function parseRecipeContent(content: string): {
	agent: string;
	description?: string;
	includeInHistory: boolean;
	oneShot: boolean;
	instructions: string;
} {
	const parsed = extractFrontmatter(content);
	if (!parsed) {
		return {
			agent: DEFAULT_RECIPE_AGENT,
			includeInHistory: true,
			oneShot: false,
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
		oneShot: readFrontmatterBoolean(parsed.frontmatter, 'oneShot') ?? false,
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
	recipe: InvokableRecipe,
	args: string,
): string {
	const displayPath =
		recipe.scope === 'builtin'
			? recipe.path
			: relative(projectRoot, recipe.path) || recipe.path;
	const scopeLabel =
		recipe.scope === 'builtin'
			? 'built-in'
			: recipe.scope === 'global'
				? 'global'
				: 'project';
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
		recipe.oneShot
			? `This recipe is a reusable ${scopeLabel} instruction configured for autonomous execution. Complete it without asking questions or requesting confirmation, while respecting editing and safety rules.`
			: `This recipe is a reusable ${scopeLabel} instruction. Execute it through the normal agent flow and respect all normal tool approval, editing, and safety rules.`,
	];

	return parts.filter(Boolean).join('\n\n');
}
