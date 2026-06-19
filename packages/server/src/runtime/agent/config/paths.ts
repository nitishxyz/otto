import { getGlobalAgentsDir, getGlobalAgentsJsonPath } from '@ottocode/sdk';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AgentsJson } from '../registry.ts';
import type { AgentConfigScope } from './types.ts';

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

export function localAgentsJsonPath(projectRoot: string): string {
	return normalizePath(`${projectRoot}/.otto/agents.json`);
}

export function configPathForScope(
	projectRoot: string,
	scope: AgentConfigScope,
): string {
	return scope === 'global'
		? getGlobalAgentsJsonPath()
		: localAgentsJsonPath(projectRoot);
}

export async function readAgentsJson(path: string): Promise<AgentsJson> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return {};
		const parsed = await file.json();
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as AgentsJson;
		}
	} catch {}
	return {};
}

export async function writeAgentsJson(
	path: string,
	agents: AgentsJson,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
}

export function isLocalPromptSource(
	projectRoot: string,
	source: string,
): boolean {
	return normalizePath(source).includes(
		normalizePath(`${projectRoot}/.otto/agents`),
	);
}

export function isGlobalPromptSource(source: string): boolean {
	return normalizePath(source).includes(normalizePath(getGlobalAgentsDir()));
}

export function getPromptFileTarget(args: {
	projectRoot: string;
	scope: AgentConfigScope;
	name: string;
}): { filePath: string; configReference: string } {
	if (args.scope === 'global') {
		const filePath = normalizePath(
			join(getGlobalAgentsDir(), args.name, 'agent.md'),
		);
		return { filePath, configReference: filePath };
	}
	const configReference = normalizePath(`.otto/agents/${args.name}/agent.md`);
	return {
		filePath: normalizePath(join(args.projectRoot, configReference)),
		configReference,
	};
}

export async function writePromptFile(args: {
	projectRoot: string;
	scope: AgentConfigScope;
	name: string;
	prompt: string;
}): Promise<string> {
	const target = getPromptFileTarget(args);
	await mkdir(dirname(target.filePath), { recursive: true });
	await writeFile(target.filePath, args.prompt, 'utf8');
	return target.configReference;
}
