import type { SkillDefinition, SkillMetadata, SkillScope } from './types.ts';
import { validateMetadata } from './validator.ts';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const MAX_DERIVED_DESCRIPTION_LENGTH = 100;

export function parseSkillFile(
	content: string,
	path: string,
	scope: SkillScope,
): SkillDefinition {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) {
		throw new Error(`Invalid SKILL.md format: missing frontmatter in ${path}`);
	}

	const [, yamlStr, body] = match;
	if (!yamlStr) {
		throw new Error(`Empty frontmatter in ${path}`);
	}

	const metadata = parseYamlFrontmatter(yamlStr, path);
	if (
		metadata.description === undefined ||
		(typeof metadata.description === 'string' && !metadata.description.trim())
	) {
		metadata.description = deriveDescriptionFromContent(body);
	}
	validateMetadata(metadata, path);

	return {
		metadata: metadata as SkillMetadata,
		content: body?.trim() ?? '',
		path,
		scope,
	};
}

function deriveDescriptionFromContent(body: string | undefined): string {
	const firstLine = (body ?? '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	const normalized = (firstLine ?? 'Skill instructions')
		.replace(/^#{1,6}\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (normalized.length <= MAX_DERIVED_DESCRIPTION_LENGTH) {
		return normalized;
	}
	return `${normalized.slice(0, MAX_DERIVED_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}

function parseYamlFrontmatter(
	yaml: string,
	_path: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = yaml.split('\n');
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];
		if (!line || !line.trim()) {
			index += 1;
			continue;
		}

		const indent = line.search(/\S/);
		if (indent > 0) {
			index += 1;
			continue;
		}

		const trimmed = line.trim();
		const colonIdx = trimmed.indexOf(':');
		if (colonIdx === -1) {
			index += 1;
			continue;
		}

		const key = normalizeKey(trimmed.slice(0, colonIdx).trim());
		const value = trimmed.slice(colonIdx + 1).trim();

		// Handle YAML block scalars with optional chomping/indentation indicators:
		// `|`, `>`, `|-`, `>-`, `|+`, `>+`, `|2`, `>2-`, etc.
		const blockScalarMatch = value.match(/^([|>])[-+]?\d*[-+]?$/);
		if (blockScalarMatch) {
			const style = blockScalarMatch[1] as '|' | '>';
			const { content, nextIndex } = readBlockScalar(
				lines,
				index + 1,
				indent,
				style,
			);
			result[key] = content;
			index = nextIndex;
			continue;
		}

		if (!value) {
			const { content, nextIndex } = readIndentedValue(
				lines,
				index + 1,
				indent,
			);
			result[key] = content;
			index = nextIndex;
			continue;
		}

		result[key] = parseYamlValue(value);
		index += 1;
	}

	return result;
}

function readIndentedValue(
	lines: string[],
	startIndex: number,
	parentIndent: number,
): { content: Record<string, string> | string; nextIndex: number } {
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line || !line.trim()) continue;

		const indent = line.search(/\S/);
		if (indent <= parentIndent) {
			return { content: '', nextIndex: index };
		}

		if (isNestedObjectLine(line.trim())) {
			return readNestedObject(lines, startIndex, parentIndent);
		}

		return readIndentedScalar(lines, startIndex, parentIndent);
	}

	return { content: '', nextIndex: lines.length };
}

function readNestedObject(
	lines: string[],
	startIndex: number,
	parentIndent: number,
): { content: Record<string, string>; nextIndex: number } {
	const result: Record<string, string> = {};
	let index = startIndex;

	while (index < lines.length) {
		const line = lines[index];
		if (!line || !line.trim()) {
			index += 1;
			continue;
		}

		const indent = line.search(/\S/);
		if (indent <= parentIndent) break;

		const trimmed = line.trim();
		const colonIdx = trimmed.indexOf(':');
		if (colonIdx === -1) {
			index += 1;
			continue;
		}

		const key = normalizeKey(trimmed.slice(0, colonIdx).trim());
		const value = trimmed.slice(colonIdx + 1).trim();

		const blockScalarMatch = value.match(/^([|>])[-+]?\d*[-+]?$/);
		if (blockScalarMatch) {
			const style = blockScalarMatch[1] as '|' | '>';
			const block = readBlockScalar(lines, index + 1, indent, style);
			result[key] = block.content;
			index = block.nextIndex;
			continue;
		}

		result[key] = String(parseYamlValue(value));
		index += 1;
	}

	return { content: result, nextIndex: index };
}

function readIndentedScalar(
	lines: string[],
	startIndex: number,
	parentIndent: number,
): { content: string; nextIndex: number } {
	const scalarLines: string[] = [];
	let index = startIndex;
	let contentIndent: number | null = null;

	while (index < lines.length) {
		const line = lines[index];
		if (!line) {
			scalarLines.push('');
			index += 1;
			continue;
		}

		if (!line.trim()) {
			scalarLines.push('');
			index += 1;
			continue;
		}

		const indent = line.search(/\S/);
		if (indent <= parentIndent) break;

		contentIndent ??= indent;
		scalarLines.push(line.slice(contentIndent));
		index += 1;
	}

	return { content: foldBlockScalar(scalarLines), nextIndex: index };
}

function readBlockScalar(
	lines: string[],
	startIndex: number,
	parentIndent: number,
	style: '|' | '>',
): { content: string; nextIndex: number } {
	const blockLines: string[] = [];
	let index = startIndex;
	let contentIndent: number | null = null;

	while (index < lines.length) {
		const line = lines[index];
		if (!line) {
			blockLines.push('');
			index += 1;
			continue;
		}

		if (!line.trim()) {
			blockLines.push('');
			index += 1;
			continue;
		}

		const indent = line.search(/\S/);
		if (indent <= parentIndent) break;

		contentIndent ??= indent;
		blockLines.push(line.slice(contentIndent));
		index += 1;
	}

	const content =
		style === '>' ? foldBlockScalar(blockLines) : blockLines.join('\n').trim();
	return { content, nextIndex: index };
}

function foldBlockScalar(lines: string[]): string {
	const segments: string[] = [];
	let current = '';

	for (const line of lines) {
		if (!line.trim()) {
			if (current) {
				segments.push(current.trim());
				current = '';
			}
			continue;
		}

		current = current ? `${current} ${line.trim()}` : line.trim();
	}

	if (current) {
		segments.push(current.trim());
	}

	return segments.join('\n');
}

function normalizeKey(key: string): string {
	if (key === 'allowed-tools') return 'allowedTools';
	return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function isNestedObjectLine(line: string): boolean {
	return /^[A-Za-z0-9_-]+\s*:/.test(line);
}

function parseYamlValue(value: string): unknown {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}

	if (
		(value.startsWith('{') && value.endsWith('}')) ||
		(value.startsWith('[') && value.endsWith(']'))
	) {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			return value;
		}
	}

	return value;
}

export function extractFrontmatter(
	content: string,
): { frontmatter: string; body: string } | null {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) return null;
	return {
		frontmatter: match[1] ?? '',
		body: match[2] ?? '',
	};
}
