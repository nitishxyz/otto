import { describe, expect, test } from 'bun:test';
import {
	extractSkillFrontmatter,
	normalizeSkillFrontmatter,
	parseSkillFile,
} from '../packages/sdk/src/skills/index.ts';

describe('skill frontmatter helpers', () => {
	test('extracts CRLF frontmatter and body', () => {
		expect(
			extractSkillFrontmatter(
				'---\r\nname: example\r\ndescription: "Quoted value"\r\n---\r\nBody\r\n',
			),
		).toEqual({
			frontmatter: 'name: example\r\ndescription: "Quoted value"',
			body: 'Body\r\n',
		});
	});

	test('returns null when delimiters are missing', () => {
		expect(extractSkillFrontmatter('name: example\n---\nBody')).toBeNull();
	});

	test('adds missing name while preserving quoted and multiline fields', () => {
		const normalized = normalizeSkillFrontmatter(
			'---\ndescription: >\n  Existing multiline\n  description\nmetadata:\n  author: "Otto Team"\n---\nBody',
			'effective-name',
		);

		expect(normalized).toContain('name: effective-name');
		expect(normalized).toContain('description: >\n  Existing multiline');
		expect(normalized).toContain('author: "Otto Team"');
		expect(
			parseSkillFile(normalized, 'SKILL.md', 'project').metadata.name,
		).toBe('effective-name');
	});

	test('replaces quoted and multiline effective fields without stale lines', () => {
		const normalized = normalizeSkillFrontmatter(
			'---\nname: "old-name"\ndescription: |\n  Old line one\n  Old line two\nlicense: MIT\n---\nBody',
			'new-name',
			'New description',
		);

		expect(normalized).toContain('name: new-name');
		expect(normalized).toContain('description: "New description"');
		expect(normalized).toContain('license: MIT');
		expect(normalized).not.toContain('Old line');
	});
});
