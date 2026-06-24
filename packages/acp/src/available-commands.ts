import type {
	AgentSideConnection,
	AvailableCommand,
} from '@agentclientprotocol/sdk';
import { listAvailableSlashCommands } from '@ottocode/server/runtime/commands/available';
import { discoverProjectRecipes } from '@ottocode/server/runtime/commands/recipes';
import {
	discoverSkills,
	filterDiscoveredSkills,
	loadConfig,
} from '@ottocode/sdk';
import { isConnectionClosedError } from './errors';

const ACP_COMMAND_NAMES = new Set([
	...listAvailableSlashCommands().map((command) => command.name),
	'mcp',
	'stage',
	'reasoning',
]);

export function queueAvailableCommands(
	client: AgentSideConnection,
	sessionId: string,
	cwd?: string,
): void {
	for (const delayMs of [0, 250]) {
		setTimeout(() => {
			void sendAvailableCommands(client, sessionId, cwd).catch((err) => {
				if (isConnectionClosedError(err)) return;
				console.error('[acp] Failed to send available commands:', err);
			});
		}, delayMs);
	}
}

async function sendAvailableCommands(
	client: AgentSideConnection,
	sessionId: string,
	cwd?: string,
): Promise<void> {
	const skillCommands = await listSkillCommands(cwd);
	const recipeCommands = await listRecipeCommands(cwd);
	const availableCommands: AvailableCommand[] = [
		...listAvailableSlashCommands().map((command) => ({
			name: command.name,
			description: command.description,
			...(command.input ? { input: command.input } : {}),
		})),
		...recipeCommands,
		...skillCommands,
		{
			name: 'mcp',
			description: 'List, start, stop, and inspect MCP servers',
			input: { hint: 'list | status | start <name> | stop <name>' },
		},
		{
			name: 'stage',
			description: 'Stage all changes or specific paths',
			input: { hint: '[path ...]' },
		},
		{
			name: 'reasoning',
			description: 'Show or set reasoning and effort level',
			input: { hint: 'on | off | set <effort>' },
		},
	];

	await client.sessionUpdate({
		sessionId,
		update: {
			sessionUpdate: 'available_commands_update',
			availableCommands,
		},
	});
}

async function listRecipeCommands(cwd?: string): Promise<AvailableCommand[]> {
	if (!cwd) return [];
	try {
		const cfg = await loadConfig(cwd);
		const recipes = await discoverProjectRecipes(cfg.projectRoot);
		return recipes
			.filter((recipe) => !ACP_COMMAND_NAMES.has(recipe.name))
			.map((recipe) => ({
				name: recipe.name,
				description: recipe.description || 'Project recipe',
				input: { hint: '[args]' },
			}));
	} catch (err) {
		console.error('[acp] Failed to discover recipes:', err);
		return [];
	}
}

async function listSkillCommands(cwd?: string): Promise<AvailableCommand[]> {
	if (!cwd) return [];
	try {
		const cfg = await loadConfig(cwd);
		const skills = filterDiscoveredSkills(
			await discoverSkills(cwd, cfg.projectRoot),
			cfg.skills,
		);
		return skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
		}));
	} catch (err) {
		console.error('[acp] Failed to discover skills:', err);
		return [];
	}
}
