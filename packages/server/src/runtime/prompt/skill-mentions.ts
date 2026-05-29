import {
	discoverSkillFiles,
	filterDiscoveredSkills,
	loadSkill,
	type DiscoveredSkill,
	type OttoConfig,
} from '@ottocode/sdk';

const SKILL_MENTION_REGEX = /(^|[\s([{])\$([a-z0-9]+(?:-[a-z0-9]+)*)/g;

export type ExplicitSkillContextOptions = {
	content?: string;
	skills: DiscoveredSkill[];
	skillSettings?: OttoConfig['skills'];
};

export async function buildExplicitSkillMentionContext({
	content,
	skills,
	skillSettings,
}: ExplicitSkillContextOptions): Promise<string> {
	const mentionedSkills = extractExplicitSkillMentions(
		content ?? '',
		skills,
		skillSettings,
	);
	if (mentionedSkills.length === 0) return '';

	const blocks: string[] = [];
	for (const name of mentionedSkills) {
		const skill = await loadSkill(name);
		if (!skill) continue;

		const availableFiles = await discoverSkillFiles(name);
		const fileManifest =
			availableFiles.length > 0
				? availableFiles
						.map((file) => `- ${file.relativePath} (${file.size} bytes)`)
						.join('\n')
				: 'No supporting files discovered.';

		blocks.push(
			[
				`<skill name="${skill.metadata.name}" scope="${skill.scope}" path="${skill.path}">`,
				'<description>',
				skill.metadata.description,
				'</description>',
				'<skill-md>',
				skill.content,
				'</skill-md>',
				'<available-supporting-files>',
				fileManifest,
				'</available-supporting-files>',
				'</skill>',
			].join('\n'),
		);
	}

	if (blocks.length === 0) return '';

	return [
		'<explicitly-requested-skills>',
		'The user explicitly mentioned these skills with $skill syntax. Treat them as active for this turn. Follow each SKILL.md below. Do not call the skill tool just to load these SKILL.md files again; they are already loaded here. Supporting files are listed for progressive disclosure; use the skill tool with a specific file only when the skill instructions or task make a supporting file relevant.',
		'',
		blocks.join('\n\n'),
		'</explicitly-requested-skills>',
	].join('\n');
}

export function extractExplicitSkillMentions(
	content: string,
	skills: DiscoveredSkill[],
	skillSettings?: OttoConfig['skills'],
): string[] {
	if (!content.includes('$')) return [];

	const available = new Map(
		filterDiscoveredSkills(skills, skillSettings).map((skill) => [
			skill.name,
			skill,
		]),
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
