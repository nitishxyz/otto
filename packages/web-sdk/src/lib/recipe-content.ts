export interface ParsedRecipeContent {
	description: string;
	agent: string;
	includeInHistory: boolean;
	instructions: string;
	unknownFrontmatter: string[];
	error?: string;
}

const KNOWN_FIELDS = new Set(['description', 'agent', 'includeinhistory']);

function readScalar(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function scalarLine(lines: string[], key: string): string | undefined {
	const target = key.toLowerCase();
	for (const line of lines) {
		const match = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/);
		if (match?.[1]?.toLowerCase() === target) {
			return readScalar(match[2] ?? '');
		}
	}
	return undefined;
}

function quoteScalar(value: string): string {
	return JSON.stringify(value.trim());
}

/** Parses a recipe Markdown file into fields suitable for the recipe editor. */
export function parseRecipeContent(
	content: string,
	fallbacks: {
		description?: string;
		agent?: string;
		includeInHistory?: boolean;
	} = {},
): ParsedRecipeContent {
	const normalized = content.replace(/\r\n?/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return {
			description: fallbacks.description ?? '',
			agent: fallbacks.agent ?? 'build',
			includeInHistory: fallbacks.includeInHistory ?? true,
			instructions: normalized.trim(),
			unknownFrontmatter: [],
		};
	}

	const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
	if (!match) {
		return {
			description: fallbacks.description ?? '',
			agent: fallbacks.agent ?? 'build',
			includeInHistory: fallbacks.includeInHistory ?? true,
			instructions: '',
			unknownFrontmatter: [],
			error:
				'This recipe has invalid metadata and cannot be edited safely. Fix the source file, then reopen it.',
		};
	}

	const frontmatterLines = (match[1] ?? '').split('\n');
	const body = match[2] ?? '';
	const includeInHistory = scalarLine(frontmatterLines, 'includeInHistory');
	const unknownFrontmatter = frontmatterLines.filter((line) => {
		const match = line.match(/^\s*([A-Za-z][\w-]*)\s*:/);
		return !match?.[1] || !KNOWN_FIELDS.has(match[1].toLowerCase());
	});

	return {
		description:
			scalarLine(frontmatterLines, 'description') ??
			fallbacks.description ??
			'',
		agent: scalarLine(frontmatterLines, 'agent') ?? fallbacks.agent ?? 'build',
		includeInHistory:
			includeInHistory === undefined
				? (fallbacks.includeInHistory ?? true)
				: includeInHistory.toLowerCase() !== 'false',
		instructions: body.trim(),
		unknownFrontmatter,
	};
}

/** Serializes structured recipe fields while preserving unknown metadata lines. */
export function serializeRecipeContent(fields: {
	description: string;
	agent: string;
	includeInHistory: boolean;
	instructions: string;
	unknownFrontmatter?: string[];
}): string {
	const metadata = [
		`description: ${quoteScalar(fields.description)}`,
		`agent: ${quoteScalar(fields.agent || 'build')}`,
		`includeInHistory: ${String(fields.includeInHistory)}`,
		...(fields.unknownFrontmatter ?? []),
	];
	return ['---', ...metadata, '---', '', fields.instructions.trim()].join('\n');
}
