export type MentionableAgent = {
	name: string;
	description?: string;
};

const MENTION_TOKEN_REGEX = /(^|[\s([{])@(\S+)/g;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?)\]}'"`]+$/;

/**
 * Extracts explicit @agent mentions from user content. A token only counts as
 * an agent mention when the full token (minus trailing punctuation) exactly
 * matches a known agent name, so file mentions like `@src/index.ts` or
 * `@README.md` are never misread as agents.
 */
export function extractExplicitAgentMentions(
	content: string,
	agents: MentionableAgent[],
): MentionableAgent[] {
	if (!content.includes('@') || agents.length === 0) return [];

	const available = new Map(agents.map((agent) => [agent.name, agent]));
	const seen = new Set<string>();
	const result: MentionableAgent[] = [];

	for (const match of content.matchAll(MENTION_TOKEN_REGEX)) {
		const token = match[2]?.replace(TRAILING_PUNCTUATION_REGEX, '');
		if (!token || token.includes('/') || seen.has(token)) continue;
		const agent = available.get(token);
		if (!agent) continue;
		seen.add(token);
		result.push(agent);
	}

	return result;
}

/**
 * Builds a system prompt block for agents the user explicitly mentioned with
 * @agent syntax, instructing the running agent to delegate to them via
 * the subagent tool.
 */
export function buildExplicitAgentMentionContext(options: {
	content?: string;
	agents: MentionableAgent[];
}): string {
	const mentioned = extractExplicitAgentMentions(
		options.content ?? '',
		options.agents,
	);
	if (mentioned.length === 0) return '';

	const lines = mentioned.map((agent) =>
		agent.description
			? `- ${agent.name}: ${agent.description}`
			: `- ${agent.name}`,
	);

	return [
		'<explicitly-mentioned-agents>',
		'The user explicitly mentioned these sub-agents with @agent syntax. Treat each mention as a direct instruction to involve that agent:',
		...lines,
		'',
		'Delegate the relevant work with subagent(action: "delegate", ...). Once delegated, that work is owned by the sub-agent; do not redo it unless the child fails. Only skip delegation when the request is trivial, and say why.',
		'</explicitly-mentioned-agents>',
	].join('\n');
}
