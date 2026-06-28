import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	parseSkillFile,
	validateSkillName,
	discoverSkills,
	initializeSkills,
	buildSkillTool,
	rebuildSkillDescription,
	clearSkillCache,
} from '../packages/sdk/src/skills/index.ts';

describe('Skills', () => {
	let tempDir: string;
	const originalHome = process.env.HOME;
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `otto-skills-test-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });
		clearSkillCache();
		process.env.HOME = originalHome;
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
		process.env.HOME = originalHome;
		if (originalXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
		}
	});

	describe('validateSkillName', () => {
		test('accepts valid names', () => {
			expect(validateSkillName('git-release')).toBe(true);
			expect(validateSkillName('my-skill')).toBe(true);
			expect(validateSkillName('skill123')).toBe(true);
			expect(validateSkillName('a')).toBe(true);
			expect(validateSkillName('abc')).toBe(true);
		});

		test('rejects invalid names', () => {
			expect(validateSkillName('')).toBe(false);
			expect(validateSkillName('My-Skill')).toBe(false);
			expect(validateSkillName('-skill')).toBe(false);
			expect(validateSkillName('skill-')).toBe(false);
			expect(validateSkillName('skill--name')).toBe(false);
			expect(validateSkillName('skill_name')).toBe(false);
			expect(validateSkillName('skill.name')).toBe(false);
			expect(validateSkillName('a'.repeat(65))).toBe(false);
		});
	});

	describe('parseSkillFile', () => {
		test('parses valid SKILL.md', () => {
			const content = `---
name: git-release
description: Create releases and changelogs
---

## What I do
Create releases.
`;
			const skill = parseSkillFile(content, '/path/to/SKILL.md', 'cwd');

			expect(skill.metadata.name).toBe('git-release');
			expect(skill.metadata.description).toBe('Create releases and changelogs');
			expect(skill.content).toContain('## What I do');
			expect(skill.scope).toBe('cwd');
		});

		test('parses optional fields', () => {
			const content = `---
name: my-skill
description: A skill with all fields
license: MIT
compatibility: Requires git
metadata:
  author: test
  version: "1.0"
allowed-tools: Bash(git:*) Read
---

Content here.
`;
			const skill = parseSkillFile(content, '/path/to/SKILL.md', 'user');

			expect(skill.metadata.name).toBe('my-skill');
			expect(skill.metadata.license).toBe('MIT');
			expect(skill.metadata.compatibility).toBe('Requires git');
			expect(skill.metadata.metadata?.author).toBe('test');
			expect(skill.metadata.metadata?.version).toBe('1.0');
			expect(skill.scope).toBe('user');
		});

		test('parses block scalar descriptions and inline metadata objects', () => {
			const content = `---
name: colosseum-copilot
description: |
	Research Solana/crypto startup opportunities using builder project history, crypto archives,
	investor theses, and market signals.
license: Proprietary
metadata: {"category":"copilot","author":"colosseum"}
---

Content here.
`;
			const skill = parseSkillFile(content, '/path/to/SKILL.md', 'user');

			expect(skill.metadata.name).toBe('colosseum-copilot');
			expect(skill.metadata.description).toContain(
				'Research Solana/crypto startup opportunities',
			);
			expect(skill.metadata.description).toContain('investor theses');
			expect(skill.metadata.metadata?.category).toBe('copilot');
			expect(skill.metadata.metadata?.author).toBe('colosseum');
		});

		test('parses indented multiline descriptions without block scalar markers', () => {
			const content = `---
name: vercel-react-native-skills
description:
	React Native and Expo best practices for building performant mobile apps. Use
	when building React Native components, optimizing list performance,
	implementing animations, or working with native modules.
license: MIT
metadata:
	author: vercel
---

Content here.
`;
			const skill = parseSkillFile(content, '/path/to/SKILL.md', 'user');

			expect(skill.metadata.name).toBe('vercel-react-native-skills');
			expect(skill.metadata.description).toContain(
				'React Native and Expo best practices for building performant mobile apps.',
			);
			expect(skill.metadata.description).toContain(
				'optimizing list performance',
			);
			expect(skill.metadata.metadata?.author).toBe('vercel');
		});

		test('throws on missing frontmatter', () => {
			const content = `# No frontmatter
Just content.
`;
			expect(() => parseSkillFile(content, '/path/to/SKILL.md', 'cwd')).toThrow(
				'missing frontmatter',
			);
		});

		test('throws on missing name', () => {
			const content = `---
description: No name field
---

Content.
`;
			expect(() => parseSkillFile(content, '/path/to/SKILL.md', 'cwd')).toThrow(
				"Missing required 'name'",
			);
		});

		test('derives missing description from first content line', () => {
			const content = `---
name: my-skill
---

# My Skill Workflow

Content.
`;
			const skill = parseSkillFile(content, '/path/to/SKILL.md', 'cwd');

			expect(skill.metadata.description).toBe('My Skill Workflow');
		});

		test('limits derived descriptions to 100 characters', () => {
			const content = `---
name: my-skill
---

This is a very long first line that should be used as the derived description but truncated before it becomes too large for the skill catalog.
`;
			const skill = parseSkillFile(content, '/path/to/SKILL.md', 'cwd');

			expect(skill.metadata.description.length).toBeLessThanOrEqual(100);
			expect(skill.metadata.description.endsWith('...')).toBe(true);
			expect(skill.metadata.description).toBe(
				'This is a very long first line that should be used as the derived description but truncated befor...',
			);
		});

		test('throws on invalid name', () => {
			const content = `---
name: My-Invalid-Name
description: Test
---

Content.
`;
			expect(() => parseSkillFile(content, '/path/to/SKILL.md', 'cwd')).toThrow(
				'Invalid skill name',
			);
		});
	});

	describe('discoverSkills', () => {
		test('discovers skills from .otto/skills/', async () => {
			const skillDir = join(tempDir, '.otto/skills/test-skill');
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				join(skillDir, 'SKILL.md'),
				`---
name: test-skill
description: A test skill
---

Test content.
`,
			);

			const skills = await discoverSkills(tempDir);

			const testSkill = skills.find((s) => s.name === 'test-skill');
			expect(testSkill).toBeDefined();
			expect(testSkill?.description).toBe('A test skill');
			expect(testSkill?.scope).toBe('cwd');
		});

		test('discovers skills from .agents/skills/', async () => {
			const skillDir = join(tempDir, '.agents/skills/agents-skill');
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				join(skillDir, 'SKILL.md'),
				`---
name: agents-skill
description: Agents compatible skill
---

Content.
`,
			);

			const skills = await discoverSkills(tempDir);

			const agentsSkill = skills.find((s) => s.name === 'agents-skill');
			expect(agentsSkill).toBeDefined();
			expect(agentsSkill?.name).toBe('agents-skill');
			expect(agentsSkill?.scope).toBe('cwd');
		});

		test('discovers skills from .claude/skills/', async () => {
			const skillDir = join(tempDir, '.claude/skills/claude-skill');
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				join(skillDir, 'SKILL.md'),
				`---
name: claude-skill
description: Claude compatible skill
---

Content.
`,
			);

			const skills = await discoverSkills(tempDir);

			const claudeSkill = skills.find((s) => s.name === 'claude-skill');
			expect(claudeSkill).toBeDefined();
			expect(claudeSkill?.name).toBe('claude-skill');
		});

		test('later paths override earlier (scope precedence)', async () => {
			const globalSkillDir = join(
				tempDir,
				'global/.config/otto/skills/shared-skill',
			);
			const projectSkillDir = join(
				tempDir,
				'project/.otto/skills/shared-skill',
			);

			await fs.mkdir(globalSkillDir, { recursive: true });
			await fs.mkdir(projectSkillDir, { recursive: true });

			await fs.writeFile(
				join(globalSkillDir, 'SKILL.md'),
				`---
name: shared-skill
description: Global version
---

Global content.
`,
			);

			await fs.writeFile(
				join(projectSkillDir, 'SKILL.md'),
				`---
name: shared-skill
description: Project version
---

Project content.
`,
			);

			const projectRoot = join(tempDir, 'project');
			const skills = await discoverSkills(projectRoot);

			const sharedSkill = skills.find((s) => s.name === 'shared-skill');
			expect(sharedSkill).toBeDefined();
			expect(sharedSkill?.description).toBe('Project version');
		});

		test('prefers project .agents skills over home .agents skills', async () => {
			const homeDir = join(tempDir, 'home');
			const globalSkillDir = join(
				homeDir,
				'.agents/skills/shared-agents-skill',
			);
			const projectSkillDir = join(
				tempDir,
				'project/.agents/skills/shared-agents-skill',
			);

			await fs.mkdir(globalSkillDir, { recursive: true });
			await fs.mkdir(projectSkillDir, { recursive: true });

			await fs.writeFile(
				join(globalSkillDir, 'SKILL.md'),
				`---
name: shared-agents-skill
description: Home agents version
---

Global content.
`,
			);

			await fs.writeFile(
				join(projectSkillDir, 'SKILL.md'),
				`---
name: shared-agents-skill
description: Project agents version
---

Project content.
`,
			);

			process.env.HOME = homeDir;
			const projectRoot = join(tempDir, 'project');
			const skills = await discoverSkills(projectRoot);

			const sharedSkill = skills.find((s) => s.name === 'shared-agents-skill');
			expect(sharedSkill).toBeDefined();
			expect(sharedSkill?.description).toBe('Project agents version');
		});

		test('discovers global .agents skills with block scalar metadata', async () => {
			const homeDir = join(tempDir, 'home');
			const globalSkillDir = join(homeDir, '.agents/skills/colosseum-copilot');

			await fs.mkdir(globalSkillDir, { recursive: true });
			await fs.writeFile(
				join(globalSkillDir, 'SKILL.md'),
				`---
name: colosseum-copilot
description: |
  Research Solana/crypto startup opportunities using builder project history, crypto archives,
  investor theses, and market signals.
license: Proprietary
metadata: {"category":"copilot","author":"colosseum"}
---

Content.
`,
			);

			process.env.HOME = homeDir;
			const skills = await discoverSkills(tempDir);

			const skill = skills.find((s) => s.name === 'colosseum-copilot');
			expect(skill).toBeDefined();
			expect(skill?.scope).toBe('user');
			expect(skill?.description).toContain(
				'Research Solana/crypto startup opportunities',
			);
		});

		test('discovers global .agents skills with indented multiline descriptions', async () => {
			const homeDir = join(tempDir, 'home');
			const globalSkillDir = join(
				homeDir,
				'.agents/skills/vercel-react-native-skills',
			);

			await fs.mkdir(globalSkillDir, { recursive: true });
			await fs.writeFile(
				join(globalSkillDir, 'SKILL.md'),
				`---
name: vercel-react-native-skills
description:
	React Native and Expo best practices for building performant mobile apps. Use
	when building React Native components, optimizing list performance,
	implementing animations, or working with native modules.
license: MIT
metadata:
	author: vercel
---

Content.
`,
			);

			process.env.HOME = homeDir;
			const skills = await discoverSkills(tempDir);

			const skill = skills.find((s) => s.name === 'vercel-react-native-skills');
			expect(skill).toBeDefined();
			expect(skill?.scope).toBe('user');
			expect(skill?.description).toContain('optimizing list performance');
		});

		test('keeps home .agents skills scoped as user when repoRoot is provided', async () => {
			const homeDir = join(tempDir, 'home');
			const projectRoot = join(tempDir, 'project');
			const globalSkillDir = join(homeDir, '.agents/skills/home-copilot');
			const projectSkillDir = join(projectRoot, '.otto/skills/project-skill');

			await fs.mkdir(globalSkillDir, { recursive: true });
			await fs.mkdir(projectSkillDir, { recursive: true });
			await fs.writeFile(
				join(globalSkillDir, 'SKILL.md'),
				`---
name: home-copilot
description: Home skill
---

Content.
`,
			);
			await fs.writeFile(
				join(projectSkillDir, 'SKILL.md'),
				`---
name: project-skill
description: Project skill
---

Content.
`,
			);

			process.env.HOME = homeDir;
			const skills = await discoverSkills(projectRoot, projectRoot);

			const homeSkill = skills.find((s) => s.name === 'home-copilot');
			expect(homeSkill).toBeDefined();
			expect(homeSkill?.scope).toBe('user');
		});

		test('does not find project skills in empty temp dir', async () => {
			const skills = await discoverSkills(tempDir);
			const projectSkills = skills.filter(
				(s) => s.scope === 'cwd' || s.scope === 'repo',
			);
			expect(projectSkills).toEqual([]);
		});

		test('ignores invalid SKILL.md files', async () => {
			const validDir = join(tempDir, '.otto/skills/valid-skill');
			const invalidDir = join(tempDir, '.otto/skills/invalid-skill');

			await fs.mkdir(validDir, { recursive: true });
			await fs.mkdir(invalidDir, { recursive: true });

			await fs.writeFile(
				join(validDir, 'SKILL.md'),
				`---
name: valid-skill
description: Valid skill
---

Content.
`,
			);

			await fs.writeFile(join(invalidDir, 'SKILL.md'), `# No frontmatter`);

			const skills = await discoverSkills(tempDir);

			const validSkill = skills.find((s) => s.name === 'valid-skill');
			const invalidSkill = skills.find((s) => s.name === 'invalid-skill');
			expect(validSkill).toBeDefined();
			expect(invalidSkill).toBeUndefined();
		});

		test('discovers enabled plugin skills and loads content through the skill tool', async () => {
			const projectRoot = join(tempDir, 'project');
			const pluginDir = join(projectRoot, '.otto/plugins/demo-plugin');
			const skillDir = join(pluginDir, 'skills/plugin-skill');
			process.env.XDG_CONFIG_HOME = join(tempDir, 'xdg-config');
			process.env.HOME = join(tempDir, 'home');

			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				join(pluginDir, 'otto.plugin.json'),
				`${JSON.stringify(
					{
						name: 'demo-plugin',
						version: '1.0.0',
						skills: [
							{
								name: 'plugin-skill',
								path: 'skills/plugin-skill/SKILL.md',
								description:
									'Compact plugin capability. Also use when extra routing text appears.',
							},
						],
					},
					null,
					2,
				)}\n`,
			);
			await fs.writeFile(
				join(skillDir, 'SKILL.md'),
				`---
name: plugin-skill
description: Full plugin skill description that should not appear in summaries.
---

FULL_PLUGIN_SKILL_CONTENT
`,
			);

			const skills = await initializeSkills(projectRoot, projectRoot);
			const pluginSkill = skills.find((s) => s.name === 'plugin-skill');
			const description = rebuildSkillDescription();

			expect(pluginSkill).toBeDefined();
			expect(pluginSkill?.scope).toBe('repo');
			expect(description).toContain(
				'- plugin-skill: Compact plugin capability.',
			);
			expect(description).toContain(
				'Load a specialized skill when the task at hand matches one of the skills listed in the system prompt.',
			);
			expect(description).not.toContain('FULL_PLUGIN_SKILL_CONTENT');
			expect(description).not.toContain(
				'Full plugin skill description that should not appear in summaries',
			);

			const skillTool = buildSkillTool();
			const result = await skillTool.tool.execute({ name: 'plugin-skill' });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.content).toContain('FULL_PLUGIN_SKILL_CONTENT');
				expect(result.baseDirectory).toBe(skillDir);
				expect(result.resourceInstructions).toContain(
					'Supporting file paths are relative to this baseDirectory',
				);
			}
		});

		test('excludes disabled plugin skills', async () => {
			const projectRoot = join(tempDir, 'project');
			const pluginDir = join(projectRoot, '.otto/plugins/disabled-plugin');
			const skillDir = join(pluginDir, 'skills/disabled-skill');
			process.env.XDG_CONFIG_HOME = join(tempDir, 'xdg-config');
			process.env.HOME = join(tempDir, 'home');

			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				join(projectRoot, '.otto/plugins.json'),
				`${JSON.stringify(
					{
						version: 1,
						registries: [],
						plugins: {
							'disabled-plugin': { enabled: false },
						},
					},
					null,
					2,
				)}\n`,
			);
			await fs.writeFile(
				join(pluginDir, 'otto.plugin.json'),
				`${JSON.stringify(
					{
						name: 'disabled-plugin',
						version: '1.0.0',
						skills: [
							{
								name: 'disabled-skill',
								path: 'skills/disabled-skill/SKILL.md',
							},
						],
					},
					null,
					2,
				)}\n`,
			);
			await fs.writeFile(
				join(skillDir, 'SKILL.md'),
				`---
name: disabled-skill
description: Disabled plugin skill
---

Disabled content.
`,
			);

			const skills = await discoverSkills(projectRoot, projectRoot);

			expect(skills.find((s) => s.name === 'disabled-skill')).toBeUndefined();
		});
	});
});
