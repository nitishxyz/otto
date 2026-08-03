import {
	discoverSkills,
	findGitRoot,
	getGlobalConfigDir,
	parseSkillFile,
	resolveEffectivePlugins,
	validateSkillName,
} from '@ottocode/sdk';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	deleteAgentConfig,
	getAllAgentDetails,
	loadAgentConfigLayers,
	upsertAgentConfig,
	validateAgentName,
} from '../agent/config-management.ts';
import {
	configPathForScope,
	getPromptFileTarget,
} from '../agent/config/paths.ts';
import {
	discoverAllRecipes,
	getRecipesDir,
	isValidRecipeName,
	parseRecipeContent,
	validateRecipeNameForScope,
} from '../commands/recipes.ts';
import type {
	ForgeInput,
	ForgeKind,
	ForgeMutation,
	ForgePlan,
	ForgeScope,
	ForgeTarget,
} from './types.ts';
import { listForgeMCPServers, runForgeMCPAction } from './mcp.ts';

function normalizeName(name: string | undefined): string {
	return name?.trim().toLowerCase() ?? '';
}

function assertTargetInput(input: ForgeInput): {
	kind: ForgeKind;
	scope: ForgeScope;
	name: string;
} {
	if (!input.kind) throw new Error('kind is required');
	if (input.kind === 'mcp-server' || input.kind === 'plugin-command') {
		throw new Error(`kind '${input.kind}' uses a dedicated Forge operation`);
	}
	const scope = input.scope ?? 'project';
	const name = normalizeName(input.name);
	if (!name) throw new Error('name is required');

	if (input.kind === 'recipe' && !isValidRecipeName(name)) {
		throw new Error(
			'Invalid recipe name. Use lowercase letters, numbers, and hyphens.',
		);
	}
	if (input.kind === 'skill' && !validateSkillName(name)) {
		throw new Error(
			'Invalid skill name. Use lowercase letters, numbers, and single hyphens.',
		);
	}
	if (input.kind === 'agent') validateAgentName(name);

	return { kind: input.kind, scope, name };
}

function getSkillPath(
	projectRoot: string,
	scope: ForgeScope,
	name: string,
): string {
	const base =
		scope === 'global'
			? join(getGlobalConfigDir(), 'skills')
			: join(projectRoot, '.otto', 'skills');
	return join(base, name, 'SKILL.md');
}

function getTarget(
	projectRoot: string,
	kind: ForgeKind,
	scope: ForgeScope,
	name: string,
): ForgeTarget {
	if (kind === 'recipe') {
		return {
			kind,
			scope,
			name,
			paths: [join(getRecipesDir(scope, projectRoot), `${name}.md`)],
		};
	}
	if (kind === 'skill') {
		return {
			kind,
			scope,
			name,
			paths: [getSkillPath(projectRoot, scope, name)],
		};
	}

	const agentScope = scope === 'project' ? 'local' : 'global';
	const prompt = getPromptFileTarget({
		projectRoot,
		scope: agentScope,
		name,
	});
	return {
		kind,
		scope,
		name,
		paths: [configPathForScope(projectRoot, agentScope), prompt.filePath],
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function targetExists(
	projectRoot: string,
	target: ForgeTarget,
): Promise<boolean> {
	if (target.kind !== 'agent') return pathExists(target.paths[0] as string);
	const layers = await loadAgentConfigLayers(projectRoot);
	const entries = target.scope === 'project' ? layers.local : layers.global;
	return Object.hasOwn(entries, target.name);
}

function quoteYaml(value: string): string {
	return JSON.stringify(value);
}

function requireContent(input: ForgeInput, fallback?: string): string {
	const content = (input.content ?? fallback)?.replace(/\r\n?/g, '\n').trim();
	if (!content) throw new Error('content is required');
	return `${content}\n`;
}

function buildRecipeContent(
	input: ForgeInput,
	existingContent?: string,
): string {
	const existing = existingContent
		? parseRecipeContent(existingContent)
		: undefined;
	const body = requireContent(input, existing?.instructions);
	const lines = ['---'];
	const description = input.description?.trim() || existing?.description;
	if (description) {
		lines.push(`description: ${quoteYaml(description)}`);
	}
	lines.push(
		`agent: ${quoteYaml(input.recipeAgent?.trim() || existing?.agent || 'build')}`,
	);
	lines.push(
		`includeInHistory: ${input.includeInHistory ?? existing?.includeInHistory ?? true}`,
	);
	lines.push(`oneShot: ${input.oneShot ?? existing?.oneShot ?? false}`);
	lines.push('---', '', body.trimEnd(), '');
	const content = lines.join('\n');
	const parsed = parseRecipeContent(content);
	if (!parsed.instructions.trim())
		throw new Error('Recipe instructions are required');
	return content;
}

function buildSkillContent(
	input: ForgeInput,
	name: string,
	existingContent?: string,
): string {
	const existing = existingContent
		? parseSkillFile(existingContent, 'SKILL.md', 'cwd')
		: undefined;
	const description =
		input.description?.trim() || existing?.metadata.description;
	if (!description) throw new Error('description is required for a skill');
	const lines = [
		'---',
		`name: ${quoteYaml(name)}`,
		`description: ${quoteYaml(description)}`,
	];
	const allowedTools = input.allowedTools ?? existing?.metadata.allowedTools;
	if (allowedTools?.length) {
		lines.push(
			`allowed-tools: ${quoteYaml(
				allowedTools
					.map((item) => item.trim())
					.filter(Boolean)
					.join(' '),
			)}`,
		);
	}
	lines.push('---', '', requireContent(input, existing?.content).trimEnd(), '');
	const content = lines.join('\n');
	parseSkillFile(content, 'SKILL.md', 'cwd');
	return content;
}

function buildArtifactContent(
	input: ForgeInput,
	name: string,
	existingContent?: string,
): string {
	if (input.kind === 'recipe')
		return buildRecipeContent(input, existingContent);
	if (input.kind === 'skill')
		return buildSkillContent(input, name, existingContent);
	return requireContent(input, existingContent);
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.forge-${crypto.randomUUID()}.tmp`;
	await writeFile(temporaryPath, content, 'utf8');
	try {
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

function mutationForPlan(input: ForgeInput): ForgeMutation {
	if (input.action === 'plan') {
		if (!input.targetAction)
			throw new Error('targetAction is required for plan');
		return input.targetAction;
	}
	if (
		input.action === 'create' ||
		input.action === 'update' ||
		input.action === 'remove'
	) {
		return input.action;
	}
	throw new Error(`Action '${input.action}' does not target one capability`);
}

export async function planForgeMutation(
	projectRoot: string,
	input: ForgeInput,
): Promise<ForgePlan> {
	const normalized = assertTargetInput(input);
	const action = mutationForPlan(input);
	const target = getTarget(
		projectRoot,
		normalized.kind,
		normalized.scope,
		normalized.name,
	);
	const exists = await targetExists(projectRoot, target);

	if (action === 'create' && exists) {
		throw new Error(
			`${normalized.kind} '${normalized.name}' already exists in ${normalized.scope} scope; use update`,
		);
	}
	if ((action === 'update' || action === 'remove') && !exists) {
		throw new Error(
			`${normalized.kind} '${normalized.name}' does not exist in ${normalized.scope} scope`,
		);
	}
	if (target.kind === 'recipe' && action !== 'remove') {
		await validateRecipeName(projectRoot, target.scope, target.name);
	}

	let preview: string | undefined;
	if (action !== 'remove') {
		const existingContent =
			action === 'update'
				? await readFile(
						target.paths[target.kind === 'agent' ? 1 : 0] as string,
						'utf8',
					)
				: undefined;
		preview = buildArtifactContent(input, normalized.name, existingContent);
	}
	return {
		action,
		target,
		exists,
		changes:
			action === 'remove'
				? target.paths.map((path) => `Remove ${path}`)
				: target.paths.map(
						(path) => `${action === 'create' ? 'Create' : 'Update'} ${path}`,
					),
		...(preview ? { preview } : {}),
	};
}

async function validateRecipeName(
	projectRoot: string,
	scope: ForgeScope,
	name: string,
): Promise<void> {
	const validation = await validateRecipeNameForScope({
		projectRoot,
		scope,
		name,
	});
	if (!validation.ok) throw new Error(validation.message);
}

async function applyAgentMutation(
	projectRoot: string,
	input: ForgeInput,
	plan: ForgePlan,
): Promise<void> {
	const scope = plan.target.scope === 'project' ? 'local' : 'global';
	if (plan.action === 'remove') {
		await deleteAgentConfig({ projectRoot, name: plan.target.name, scope });
		await rm(dirname(plan.target.paths[1] as string), {
			recursive: true,
			force: true,
		});
		return;
	}
	await upsertAgentConfig({
		projectRoot,
		name: plan.target.name,
		input: {
			scope,
			prompt: plan.preview,
			promptStorage: 'file',
			...(input.description !== undefined
				? { description: input.description }
				: {}),
			...(input.tools ? { tools: input.tools } : {}),
			...(input.appendTools ? { appendTools: input.appendTools } : {}),
			...(input.provider ? { provider: input.provider } : {}),
			...(input.model ? { model: input.model } : {}),
		},
	});
}

export async function runForgeAction(projectRoot: string, input: ForgeInput) {
	if (input.kind === 'mcp-server') {
		if (input.action === 'plan') {
			if (!input.targetAction) {
				throw new Error('targetAction is required for an MCP plan');
			}
			return runForgeMCPAction(projectRoot, {
				...input,
				action: input.targetAction,
				dryRun: true,
			});
		}
		return runForgeMCPAction(projectRoot, input);
	}
	return runForgeMutation(projectRoot, input);
}

export async function runForgeMutation(
	projectRoot: string,
	input: ForgeInput,
): Promise<{ ok: true; applied: boolean; plan: ForgePlan }> {
	const plan = await planForgeMutation(projectRoot, input);
	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}

	if (plan.target.kind === 'agent') {
		await applyAgentMutation(projectRoot, input, plan);
	} else if (plan.action === 'remove') {
		const path = plan.target.paths[0] as string;
		await rm(plan.target.kind === 'skill' ? dirname(path) : path, {
			recursive: plan.target.kind === 'skill',
			force: true,
		});
	} else {
		await atomicWrite(plan.target.paths[0] as string, plan.preview as string);
	}

	return { ok: true, applied: true, plan };
}

export async function getForgeInventory(projectRoot: string) {
	const repoRoot = (await findGitRoot(projectRoot)) ?? projectRoot;
	const [recipes, skills, agentDetails, effectivePlugins, mcpServers] =
		await Promise.all([
			discoverAllRecipes(projectRoot),
			discoverSkills(projectRoot, repoRoot),
			getAllAgentDetails(projectRoot),
			resolveEffectivePlugins(projectRoot),
			listForgeMCPServers(projectRoot),
		]);

	return {
		projectRoot,
		recipes: recipes.map((recipe) => ({
			name: recipe.name,
			scope: recipe.scope,
			description: recipe.description,
			path: recipe.path,
		})),
		skills: skills.map((skill) => ({
			name: skill.name,
			scope: skill.scope,
			description: skill.description,
			path: skill.path,
		})),
		agents: agentDetails.agents.map((agent) => ({
			name: agent.name,
			source: agent.source,
			description: agent.description ?? agent.defaultDescription,
			provider: agent.provider,
			model: agent.model,
			hasProjectOverride: agent.hasLocalOverride,
			hasGlobalOverride: agent.hasGlobalOverride,
		})),
		mcpServers,
		plugins: effectivePlugins.plugins.map((plugin) => ({
			name: plugin.name,
			scope: plugin.scope,
			enabled: plugin.enabled,
			status: plugin.status,
			version: plugin.manifest?.version,
			description: plugin.manifest?.description,
			capabilities: {
				recipes: plugin.manifest?.recipes?.length ?? 0,
				skills: plugin.manifest?.skills?.length ?? 0,
				agents: plugin.manifest?.agents?.length ?? 0,
				commands: Object.keys(plugin.manifest?.commands ?? {}).length,
				mcpServers: Object.keys(plugin.manifest?.mcpServers ?? {}).length,
			},
			commands: Object.entries(plugin.manifest?.commands ?? {}).map(
				([name, command]) => ({
					name,
					label: command.label,
					description: command.description,
					parameters: command.parameters,
				}),
			),
		})),
	};
}

export async function readForgeArtifact(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return null;
	}
}
