export interface SkillMentionSkill {
	name: string;
	description?: string;
	enabled?: boolean;
}

export interface UserMessageMentionReference {
	name: string;
	description?: string;
}

export interface UserMessageMentionAgent {
	name: string;
	description?: string;
}

const SKILL_MENTION_REGEX = /(^|[\s([{])([$@])([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const MESSAGE_MENTION_REGEX = /(^|[\s([{])(@[^\s@]+|\$[a-z0-9][a-z0-9-]*)/g;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?)\]}'"`]+$/;

export function extractExplicitSkillMentions(
	content: string,
	skills: SkillMentionSkill[],
): string[] {
	if (!content.includes('$') && !content.includes('@')) return [];

	const available = new Map(
		skills
			.filter((skill) => skill.enabled !== false)
			.map((skill) => [skill.name, skill]),
	);
	const seen = new Set<string>();
	const result: string[] = [];

	for (const match of content.matchAll(SKILL_MENTION_REGEX)) {
		const name = match[3];
		if (!name || seen.has(name) || !available.has(name)) continue;
		seen.add(name);
		result.push(name);
	}

	return result;
}

export function linkifyExplicitSkillMentions(
	content: string,
	skills: SkillMentionSkill[],
): string {
	if (!content.includes('$') && !content.includes('@')) return content;

	const available = new Set(
		skills
			.filter((skill) => skill.enabled !== false)
			.map((skill) => skill.name),
	);

	return content.replace(SKILL_MENTION_REGEX, (match, prefix, symbol, name) => {
		if (!available.has(name)) return match;
		return `${prefix}[${symbol}${name}](#otto-skill:${encodeURIComponent(name)})`;
	});
}

export function linkifyUserMessageMentions(
	content: string,
	skills: SkillMentionSkill[],
	agents: UserMessageMentionAgent[] = [],
	references: UserMessageMentionReference[] = [],
): string {
	if (!content.includes('$') && !content.includes('@')) return content;

	const availableAgents = new Set(agents.map((agent) => agent.name));
	const availableReferences = new Set(
		references.map((reference) => reference.name),
	);
	const availableSkills = new Set(
		skills
			.filter((skill) => skill.enabled !== false)
			.map((skill) => skill.name),
	);

	return content.replace(MESSAGE_MENTION_REGEX, (match, prefix, token) => {
		if (token.startsWith('$')) {
			const name = token.slice(1);
			if (!availableSkills.has(name)) return match;
			return `${prefix}[${token}](#otto-skill:${encodeURIComponent(name)})`;
		}

		const trailing =
			token.slice(1).match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '';
		const mentionToken = trailing ? token.slice(0, -trailing.length) : token;
		const name = mentionToken.slice(1);
		if (!name) return match;

		if (availableAgents.has(name)) {
			return `${prefix}[${mentionToken}](#otto-agent:${encodeURIComponent(name)})${trailing}`;
		}

		if (availableSkills.has(name)) {
			return `${prefix}[${mentionToken}](#otto-skill:${encodeURIComponent(name)})${trailing}`;
		}

		if (availableReferences.has(name)) {
			return `${prefix}[${mentionToken}](#otto-reference:${encodeURIComponent(name)})${trailing}`;
		}

		if (!name.includes('/') && !name.includes('.')) return match;
		return `${prefix}[${mentionToken}](#otto-file:${encodeURIComponent(name)})${trailing}`;
	});
}
