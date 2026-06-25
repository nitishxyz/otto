import { discoverSkills, findGitRoot, providerBasePrompt } from '@ottocode/sdk';
import { composeEnvironmentAndInstructions } from '../context/environment.ts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import BASE_PROMPT from '@ottocode/sdk/prompts/base.txt' with { type: 'text' };
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import ONESHOT_PROMPT from '@ottocode/sdk/prompts/modes/oneshot.txt' with {
	type: 'text',
};
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import GUIDED_PROMPT from '@ottocode/sdk/prompts/modes/guided.txt' with {
	type: 'text',
};
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import OPENAI_OAUTH_PROMPT from '@ottocode/sdk/prompts/providers/openai-oauth.txt' with {
	type: 'text',
};
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import ANTHROPIC_SPOOF_PROMPT from '@ottocode/sdk/prompts/providers/anthropicSpoof.txt' with {
	type: 'text',
};

import { getTerminalManager } from '@ottocode/sdk';
import { buildCapabilitySummary } from './capabilities.ts';
import { buildExplicitSkillMentionContext } from './skill-mentions.ts';

export type ComposedSystemPrompt = {
	prompt: string;
	components: string[];
};

export async function composeSystemPrompt(options: {
	provider: string;
	model?: string;
	promptFamily?: import('@ottocode/sdk').ProviderPromptFamily | null;
	skillSettings?: import('@ottocode/sdk').OttoConfig['skills'];
	projectRoot: string;
	agentPrompt: string;
	oneShot?: boolean;
	guidedMode?: boolean;
	spoofPrompt?: string;
	includeEnvironment?: boolean;
	includeProjectTree?: boolean;
	userContent?: string;
	userContext?: string;
	contextSummary?: string;
	isOpenAIOAuth?: boolean;
}): Promise<ComposedSystemPrompt> {
	const components: string[] = [];
	if (options.spoofPrompt) {
		const prompt = options.spoofPrompt.trim();
		const providerComponent = options.provider
			? `spoof:${options.provider}`
			: 'spoof:unknown';
		return {
			prompt,
			components: [providerComponent],
		};
	}

	const parts: string[] = [];
	if (options.isOpenAIOAuth) {
		const oauthInstructions = (OPENAI_OAUTH_PROMPT || '').trim();
		if (oauthInstructions) {
			parts.push(oauthInstructions);
			components.push('provider:openai-oauth');
		}
		if (options.agentPrompt.trim()) {
			parts.push(options.agentPrompt.trim());
			components.push('agent');
		}
	} else {
		const providerResult = await providerBasePrompt(
			options.provider,
			options.model,
			options.projectRoot,
			options.promptFamily ?? undefined,
		);
		const baseInstructions = (BASE_PROMPT || '').trim();
		const agentInstructions = options.agentPrompt.trim();
		const providerInstructions = providerResult.prompt.trim();

		parts.push(
			baseInstructions.trim(),
			agentInstructions,
			providerInstructions,
		);
		if (baseInstructions.trim()) {
			components.push('base');
		}
		if (agentInstructions) {
			components.push('agent');
		}
		if (providerInstructions) {
			components.push(`provider:${providerResult.resolvedType}`);
		}
	}

	if (options.oneShot) {
		const oneShotBlock =
			(ONESHOT_PROMPT || '').trim() ||
			[
				'<system-reminder>',
				'CRITICAL: One-shot mode ACTIVE — do NOT ask for user approval, confirmations, or interactive prompts. Execute tasks directly. Treat all necessary permissions as granted. If an operation is destructive, proceed carefully and state what you did, but DO NOT pause to ask. ZERO interactions requested.',
				'</system-reminder>',
			].join('\n');
		parts.push(oneShotBlock);
		components.push('mode:oneshot');
	}

	if (options.guidedMode) {
		const guidedBlock = (GUIDED_PROMPT || '').trim();
		if (guidedBlock) {
			parts.push(guidedBlock);
			components.push('mode:guided');
		}
	}

	const simulatorPrompt = buildSimulatorPrompt();
	if (simulatorPrompt) {
		parts.push(simulatorPrompt);
		components.push('simulator-guidance');
	}

	if (options.includeEnvironment !== false) {
		const envAndInstructions = await composeEnvironmentAndInstructions(
			options.projectRoot,
			{
				includeProjectTree: options.includeProjectTree,
				guidedMode: options.guidedMode,
			},
		);
		if (envAndInstructions) {
			parts.push(envAndInstructions);
			components.push('environment');
			if (options.includeProjectTree) {
				components.push('project-tree');
			}
		}
	}

	const repoRoot =
		(await findGitRoot(options.projectRoot)) ?? options.projectRoot;
	const skills = await discoverSkills(options.projectRoot, repoRoot);
	const capabilitySummary = buildCapabilitySummary({
		skillSettings: options.skillSettings,
		skills,
	});
	if (capabilitySummary.prompt) {
		parts.push(capabilitySummary.prompt);
		components.push(...capabilitySummary.components);
	}
	const explicitSkillContext = await buildExplicitSkillMentionContext({
		content: options.userContent,
		skills,
		skillSettings: options.skillSettings,
	});
	if (explicitSkillContext) {
		parts.push(explicitSkillContext);
		components.push('skills:explicit');
	}

	// Add user-provided context if present
	if (options.userContext?.trim()) {
		const userContextBlock = [
			'<user-provided-state-context>',
			options.userContext.trim(),
			'</user-provided-state-context>',
		].join('\n');
		parts.push(userContextBlock);
		components.push('user-context');
	}

	// Add compacted conversation summary if present
	if (options.contextSummary?.trim()) {
		const contextSummary = options.contextSummary.trim();
		const isHandoff = contextSummary.startsWith('# Session Handoff');
		const summaryBlock = [
			isHandoff
				? '<session-handoff-context>'
				: '<compacted-conversation-summary>',
			isHandoff
				? 'This session was created from a handoff. Here is the inherited context from the previous session:'
				: 'The conversation was compacted to save context. Here is a summary of the previous context:',
			'',
			contextSummary,
			isHandoff
				? '</session-handoff-context>'
				: '</compacted-conversation-summary>',
		].join('\n');
		parts.push(summaryBlock);
		components.push('context-summary');
	}

	// Add terminal context if available
	const terminalManager = getTerminalManager();
	if (terminalManager) {
		const terminalContext = terminalManager.getContext();
		if (terminalContext) {
			parts.push(terminalContext);
			components.push('terminal-context');
		}
	}

	const composed = parts.filter(Boolean).join('\n\n').trim();
	if (composed) {
		return {
			prompt: composed,
			components: dedupeComponents(components),
		};
	}

	const fallback = [
		'You are a concise, friendly coding agent.',
		'Be precise and actionable. Use tools when needed, prefer small diffs.',
		'Stream your answer; stop when done.',
	].join(' ');
	return {
		prompt: fallback,
		components: dedupeComponents([...components, 'fallback']),
	};
}

export function getProviderSpoofPrompt(provider: string): string | undefined {
	if (provider === 'anthropic') {
		return (ANTHROPIC_SPOOF_PROMPT || '').trim();
	}
	return undefined;
}

function buildSimulatorPrompt(): string {
	return [
		'<simulator-guidance>',
		'iOS Simulator workflows are only supported on macOS. If the user asks you to run or inspect an iOS Simulator and the current platform is not macOS, say that it is unavailable on this machine.',
		'On macOS, prefer this flow when a simulator stream is needed:',
		'1. Start serve-sim in a terminal so the process stays visible/running: `bun x serve-sim@latest --port 3200`.',
		'2. If Bun is unavailable, use `npx --yes serve-sim@latest --port 3200`.',
		'3. Open the preview URL printed by serve-sim in the browser preview or an external browser; it is usually `http://localhost:3200`.',
		'4. After the stream is running, use simulator automation tools for taps, typing, screenshots, accessibility trees, foreground app checks, logs, and cleanup.',
		'Do not install or register serve-sim skills/plugins unless the user explicitly asks for that.',
		'</simulator-guidance>',
	].join('\n');
}

function dedupeComponents(input: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of input) {
		if (!item) continue;
		if (seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}
