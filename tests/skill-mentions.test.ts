import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	discoverSkills,
	clearSkillCache,
} from '../packages/sdk/src/skills/index.ts';
import {
	extractExplicitSkillMentions as extractWebSkillMentions,
	linkifyExplicitSkillMentions,
	linkifyUserMessageMentions,
} from '../packages/web-sdk/src/lib/skillMentions.ts';
import {
	buildExplicitSkillMentionContext,
	extractExplicitSkillMentions,
} from '../packages/server/src/runtime/prompt/skill-mentions.ts';

const skills = [
	{ name: 'code-review', description: 'Review code' },
	{ name: 'debug', description: 'Debug failures' },
	{ name: 'disabled-skill', description: 'Disabled', enabled: false },
];

describe('skill mentions', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `otto-skill-mentions-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });
		clearSkillCache();
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
		clearSkillCache();
	});

	test('extracts known $skill mentions in order for Web UI rendering', () => {
		expect(
			extractWebSkillMentions(
				'$code-review please also use $debug and $unknown',
				skills,
			),
		).toEqual(['code-review', 'debug']);
	});

	test('dedupes and ignores disabled skills in Web UI rendering', () => {
		expect(
			extractWebSkillMentions(
				'Use $code-review and $code-review, not $disabled-skill',
				skills,
			),
		).toEqual(['code-review']);
	});

	test('linkifies known $skill mentions for inline Web UI rendering', () => {
		expect(
			linkifyExplicitSkillMentions(
				'$code-review inspect this and ignore $unknown',
				skills,
			),
		).toBe(
			'[$code-review](#otto-skill:code-review) inspect this and ignore $unknown',
		);
	});

	test('linkifies user message skill and file mentions for inline rendering', () => {
		expect(
			linkifyUserMessageMentions(
				'Update @publish.env with $debug and ignore @unknown',
				skills,
			),
		).toBe(
			'Update [@publish.env](#otto-file:publish.env) with [$debug](#otto-skill:debug) and ignore @unknown',
		);
	});

	test('extracts known $skill mentions server-side', () => {
		expect(
			extractExplicitSkillMentions(
				'$code-review please also use $debug and $unknown',
				skills.map((skill) => ({ ...skill, path: '', scope: 'cwd' as const })),
			),
		).toEqual(['code-review', 'debug']);
	});

	test('builds server-side explicit skill context with supporting file manifest', async () => {
		const skillDir = join(tempDir, '.otto/skills/code-review');
		await fs.mkdir(join(skillDir, 'rules'), { recursive: true });
		await fs.writeFile(
			join(skillDir, 'SKILL.md'),
			`---
name: code-review
description: Review code
---

# Instructions
`,
		);
		await fs.writeFile(join(skillDir, 'rules/security.md'), '# Security');

		const discoveredSkills = await discoverSkills(tempDir);
		const context = await buildExplicitSkillMentionContext({
			content: '$code-review inspect this diff',
			skills: discoveredSkills,
		});

		expect(context).toContain('<explicitly-requested-skills>');
		expect(context).toContain('Do not call the skill tool just to load');
		expect(context).toContain('name="code-review"');
		expect(context).toContain('# Instructions');
		expect(context).toContain('rules/security.md');
	});
});
