import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeSystemPrompt } from '@ottocode/server';
import { clearSkillCache } from '@ottocode/sdk';

describe('system prompt composition', () => {
	let tempDir: string;
	let previousXdgConfigHome: string | undefined;
	let previousHome: string | undefined;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `otto-system-prompt-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });
		previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		previousHome = process.env.HOME;
		process.env.XDG_CONFIG_HOME = join(tempDir, 'xdg-config');
		process.env.HOME = join(tempDir, 'home');
		clearSkillCache();
	});

	afterEach(async () => {
		clearSkillCache();
		if (previousXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		}
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('injects one-shot override when enabled', async () => {
		const { prompt, components } = await composeSystemPrompt({
			provider: 'openrouter',
			model: 'gpt-4o-mini',
			projectRoot: process.cwd(),
			agentPrompt: 'AGENT',
			oneShot: true,
		});
		expect(prompt).toContain('One-shot mode ACTIVE');
		expect(components).toContain('mode:oneshot');
	});

	it('does not inject one-shot override when disabled', async () => {
		const { prompt, components } = await composeSystemPrompt({
			provider: 'openrouter',
			model: 'gpt-4o-mini',
			projectRoot: process.cwd(),
			agentPrompt: 'AGENT',
			oneShot: false,
		});
		expect(prompt).not.toContain('One-shot mode ACTIVE');
		expect(components).not.toContain('mode:oneshot');
	});

	it('discovers current project skills for the capability summary', async () => {
		await writeSkill('ea', 'Enterprise architecture planning guidance');

		const { prompt, components } = await composeSystemPrompt({
			provider: 'openrouter',
			model: 'gpt-4o-mini',
			projectRoot: tempDir,
			agentPrompt: 'AGENT',
			includeEnvironment: false,
		});

		expect(prompt).toContain('Skills:');
		expect(prompt).toContain(
			'- ea: Enterprise architecture planning guidance.',
		);
		expect(components).toContain('capabilities:skills');
	});

	it('discovers global skills for the capability summary', async () => {
		await writeSkill(
			'global-ea',
			'Global enterprise architecture guidance',
			'global',
		);

		const { prompt } = await composeSystemPrompt({
			provider: 'openrouter',
			model: 'gpt-4o-mini',
			projectRoot: tempDir,
			agentPrompt: 'AGENT',
			includeEnvironment: false,
		});

		expect(prompt).toContain(
			'- global-ea: Global enterprise architecture guidance.',
		);
	});

	it('omits disabled skills from the capability summary', async () => {
		await writeSkill('enabled-skill', 'Enabled skill guidance');
		await writeSkill('disabled-skill', 'Disabled skill guidance');

		const { prompt } = await composeSystemPrompt({
			provider: 'openrouter',
			model: 'gpt-4o-mini',
			projectRoot: tempDir,
			agentPrompt: 'AGENT',
			includeEnvironment: false,
			skillSettings: {
				items: { 'disabled-skill': { enabled: false } },
			},
		});

		expect(prompt).toContain('- enabled-skill: Enabled skill guidance.');
		expect(prompt).not.toContain('disabled-skill');
	});

	it('prioritizes explicitly enabled skills in the visible summary', async () => {
		for (let i = 0; i < 10; i++) {
			await writeSkill(`a-skill-${i}`, `Background skill ${i}`);
		}
		await writeSkill('ea', 'Enterprise architecture planning guidance');

		const { prompt } = await composeSystemPrompt({
			provider: 'openrouter',
			model: 'gpt-4o-mini',
			projectRoot: tempDir,
			agentPrompt: 'AGENT',
			includeEnvironment: false,
			skillSettings: { items: { ea: { enabled: true } } },
		});

		expect(prompt).toContain(
			'- ea: Enterprise architecture planning guidance.',
		);
	});

	async function writeSkill(
		name: string,
		description: string,
		scope: 'project' | 'global' = 'project',
	): Promise<void> {
		const skillDir =
			scope === 'global'
				? join(tempDir, 'xdg-config', 'otto', 'skills', name)
				: join(tempDir, '.otto', 'skills', name);
		await fs.mkdir(skillDir, { recursive: true });
		await fs.writeFile(
			join(skillDir, 'SKILL.md'),
			`---\nname: ${name}\ndescription: ${description}\n---\n\nUse this skill for ${description}.\n`,
		);
	}
});
