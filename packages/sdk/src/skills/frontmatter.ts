const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export type SkillFrontmatter = {
	frontmatter: string;
	body: string;
};

/** Extract the YAML frontmatter and body from a SKILL.md document. */
export function extractSkillFrontmatter(
	content: string,
): SkillFrontmatter | null {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) return null;
	return {
		frontmatter: match[1] ?? '',
		body: match[2] ?? '',
	};
}

/** Set effective skill metadata while preserving unrelated frontmatter fields. */
export function normalizeSkillFrontmatter(
	content: string,
	name: string,
	description?: string,
): string {
	const extracted = extractSkillFrontmatter(content);
	if (!extracted) {
		const head = [`name: ${name}`];
		if (description) head.push(`description: ${JSON.stringify(description)}`);
		return `---\n${head.join('\n')}\n---\n\n${content}`;
	}

	const lines = extracted.frontmatter.split(/\r?\n/);
	const kept: string[] = [];
	let hasName = false;
	let hasDescription = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!/^\S/.test(line)) {
			kept.push(line);
			continue;
		}
		const colonIndex = line.indexOf(':');
		const key = colonIndex === -1 ? '' : line.slice(0, colonIndex).trim();
		const replaceName = key === 'name';
		const replaceDescription =
			key === 'description' && description !== undefined;
		if (key === 'name') hasName = true;
		if (key === 'description') hasDescription = true;
		if (!replaceName && !replaceDescription) {
			kept.push(line);
			continue;
		}
		while (index + 1 < lines.length && !/^\S/.test(lines[index + 1] ?? '')) {
			index += 1;
		}
		kept.push(
			replaceName
				? `name: ${name}`
				: `description: ${JSON.stringify(description)}`,
		);
	}
	if (!hasName) kept.unshift(`name: ${name}`);
	if (description !== undefined && !hasDescription) {
		kept.push(`description: ${JSON.stringify(description)}`);
	}
	return `---\n${kept.join('\n')}\n---\n${extracted.body}`;
}
