import { noul, type JudgeClient } from '../../../judge/index.ts';
import type { MCPToolBrief } from './lazy-tools.ts';

export type MCPPreloadInput = {
	/** The user's latest request, as plain text. */
	userMessage: string;
	/** Short summary of recent conversation, if any. */
	recentContext?: string;
	briefs: MCPToolBrief[];
	/** Tools already active from earlier turns; skipped, never demoted. */
	alreadyLoaded?: ReadonlySet<string>;
};

export type MCPPreloadOptions = {
	judge: JudgeClient;
	threshold: number;
	/** Cap on tools pre-activated per turn, highest probability first. */
	maxTools?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
};

export type MCPPreloadResult = {
	selected: string[];
	probabilities: Record<string, number>;
	skipped: 'no-candidates' | 'empty-message' | 'judge-failed' | null;
};

const DEFAULT_MAX_TOOLS = 12;
const MAX_CANDIDATES = 80;
const DESCRIPTION_LIMIT = 240;
const MESSAGE_LIMIT = 4_000;

/**
 * Ask the judge which MCP tools are plausibly needed for the request and
 * return those above the threshold. A miss costs nothing: the model can still
 * load any tool by name.
 */
export async function selectMCPToolsForRequest(
	input: MCPPreloadInput,
	options: MCPPreloadOptions,
): Promise<MCPPreloadResult> {
	const message = input.userMessage.trim().slice(0, MESSAGE_LIMIT);
	if (!message)
		return { selected: [], probabilities: {}, skipped: 'empty-message' };

	const candidates = input.briefs
		.filter((b) => !input.alreadyLoaded?.has(b.name))
		.slice(0, MAX_CANDIDATES);
	if (candidates.length === 0) {
		return { selected: [], probabilities: {}, skipped: 'no-candidates' };
	}

	const questions: Record<string, ReturnType<typeof noul>> = {};
	for (let index = 0; index < candidates.length; index++) {
		questions[`tool_${index}`] = noul(
			`Would the assistant plausibly need to call the tool at \`tools[${index}]\` to complete the user's request in \`request\`?`,
			{
				true: 'The tool performs an action or fetches information the request clearly requires or strongly implies.',
				false:
					'The tool is unrelated, or the request can be completed with ordinary coding tools alone.',
			},
		);
	}

	const result = await options.judge.judge({
		state: {
			request: message,
			...(input.recentContext ? { recentContext: input.recentContext } : {}),
			tools: candidates.map((b) => ({
				server: b.server,
				name: b.name,
				description: b.description.slice(0, DESCRIPTION_LIMIT),
			})),
		},
		questions,
		timeoutMs: options.timeoutMs,
		signal: options.signal,
	});
	if (!result.ok) {
		return { selected: [], probabilities: {}, skipped: 'judge-failed' };
	}

	const probabilities: Record<string, number> = {};
	candidates.forEach((brief, index) => {
		const answer = result.answers[`tool_${index}`];
		if (answer?.type === 'noul') probabilities[brief.name] = answer.noul;
	});

	const selected = Object.entries(probabilities)
		.filter(([, p]) => p >= options.threshold)
		.sort((a, b) => b[1] - a[1])
		.slice(0, options.maxTools ?? DEFAULT_MAX_TOOLS)
		.map(([name]) => name);

	return { selected, probabilities, skipped: null };
}
