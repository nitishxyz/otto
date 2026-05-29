export interface SkillMentionSkill {
	name: string;
	description?: string;
	enabled?: boolean;
}

const SKILL_MENTION_REGEX = /(^|[\s([{])\$([a-z0-9]+(?:-[a-z0-9]+)*)/g;

export function extractExplicitSkillMentions(
	content: string,
	skills: SkillMentionSkill[],
): string[] {
	if (!content.includes('$')) return [];

	const available = new Map(
		skills
			.filter((skill) => skill.enabled !== false)
			.map((skill) => [skill.name, skill]),
	);
	const seen = new Set<string>();
	const result: string[] = [];

	for (const match of content.matchAll(SKILL_MENTION_REGEX)) {
		const name = match[2];
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
	if (!content.includes('$')) return content;

	const available = new Set(
		skills
			.filter((skill) => skill.enabled !== false)
			.map((skill) => skill.name),
	);

	return content.replace(SKILL_MENTION_REGEX, (match, prefix, name) => {
		if (!available.has(name)) return match;
		return `${prefix}[$${name}](#otto-skill:${encodeURIComponent(name)})`;
	});
}
