import { getGlobalAgentsDir } from '@ottocode/sdk';
// Embed default agent prompts; only user overrides read from disk.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import AGENT_BUILD from '@ottocode/sdk/prompts/agents/build.txt' with {
	type: 'text',
};
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import AGENT_PLAN from '@ottocode/sdk/prompts/agents/plan.txt' with {
	type: 'text',
};
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import AGENT_GENERAL from '@ottocode/sdk/prompts/agents/general.txt' with {
	type: 'text',
};
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import AGENT_INIT from '@ottocode/sdk/prompts/agents/init.txt' with {
	type: 'text',
};
import AGENT_RESEARCH from '@ottocode/sdk/prompts/agents/research.txt' with {
	type: 'text',
};
import AGENT_OTTO from '@ottocode/sdk/prompts/agents/otto.txt' with {
	type: 'text',
};

type PromptResolution = {
	prompt: string;
	source: string;
};

const EMBEDDED_AGENT_PROMPTS: Record<string, string> = {
	build: AGENT_BUILD,
	plan: AGENT_PLAN,
	general: AGENT_GENERAL,
	init: AGENT_INIT,
	research: AGENT_RESEARCH,
	otto: AGENT_OTTO,
};

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

export function getAgentPromptCandidates(
	projectRoot: string,
	name: string,
): string[] {
	const globalAgentsDir = getGlobalAgentsDir();
	return [
		normalizePath(`${projectRoot}/.otto/agents/${name}/agent.md`),
		normalizePath(`${projectRoot}/.otto/agents/${name}.md`),
		normalizePath(`${projectRoot}/.otto/agents/${name}/agent.txt`),
		normalizePath(`${projectRoot}/.otto/agents/${name}.txt`),
		normalizePath(`${globalAgentsDir}/${name}/agent.md`),
		normalizePath(`${globalAgentsDir}/${name}.md`),
		normalizePath(`${globalAgentsDir}/${name}/agent.txt`),
		normalizePath(`${globalAgentsDir}/${name}.txt`),
	];
}

async function readFirstNonEmptyFile(
	candidates: string[],
	sourcePrefix: string,
): Promise<PromptResolution | undefined> {
	for (const candidate of candidates) {
		try {
			const file = Bun.file(candidate);
			if (!(await file.exists())) continue;
			const text = await file.text();
			if (!text.trim()) continue;
			return {
				prompt: text,
				source: `${sourcePrefix}:${candidate}`,
			};
		} catch {}
	}
	return undefined;
}

function isPromptPathReference(value: string): boolean {
	return (
		/[.](md|txt)$/i.test(value) ||
		value.startsWith('.') ||
		value.startsWith('/') ||
		value.startsWith('~/')
	);
}

function getPromptReferenceCandidates(
	projectRoot: string,
	reference: string,
): string[] {
	if (reference.startsWith('~/')) {
		const home = process.env.HOME || process.env.USERPROFILE || '';
		return [normalizePath(`${home}/${reference.slice(2)}`)];
	}
	if (reference.startsWith('/')) return [normalizePath(reference)];
	return [normalizePath(`${projectRoot}/${reference}`)];
}

async function resolveAgentsJsonPrompt(
	projectRoot: string,
	promptValue: string | undefined,
): Promise<PromptResolution | undefined> {
	const prompt = promptValue?.trim();
	if (!prompt) return undefined;

	if (!isPromptPathReference(prompt)) {
		return {
			prompt,
			source: 'agents.json:inline',
		};
	}

	return readFirstNonEmptyFile(
		getPromptReferenceCandidates(projectRoot, prompt),
		'agents.json:file',
	);
}

function resolveEmbeddedPrompt(name: string): PromptResolution {
	const prompt = EMBEDDED_AGENT_PROMPTS[name]?.trim();
	if (prompt) {
		return {
			prompt,
			source: `fallback:embedded:${name}.txt`,
		};
	}

	return {
		prompt: (AGENT_BUILD || '').trim(),
		source: 'fallback:embedded:build.txt',
	};
}

export async function resolveAgentPrompt(args: {
	projectRoot: string;
	name: string;
	entryPrompt?: string;
}): Promise<PromptResolution> {
	const filePrompt = await readFirstNonEmptyFile(
		getAgentPromptCandidates(args.projectRoot, args.name),
		'file',
	);
	const agentsJsonPrompt = await resolveAgentsJsonPrompt(
		args.projectRoot,
		args.entryPrompt,
	);

	return agentsJsonPrompt ?? filePrompt ?? resolveEmbeddedPrompt(args.name);
}
