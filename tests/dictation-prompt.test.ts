import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	applyDictationKeywordAliases,
	BASE_DICTATION_PROMPT,
	deriveProjectVocabulary,
	getDictationPromptPath,
	getProjectDictationPromptPath,
	mergeDictationKeywords,
	resolveDictationPrompt,
} from '../packages/server/src/dictation/prompt.ts';

const tempConfigHome = join(tmpdir(), 'otto-dictation-prompt-tests');
const tempProjectRoot = join(tmpdir(), 'otto-dictation-prompt-project');
let originalXdgConfigHome: string | undefined;
let originalEnvPrompt: string | undefined;

beforeEach(async () => {
	originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
	originalEnvPrompt = process.env.OTTO_DICTATION_PROMPT;
	process.env.XDG_CONFIG_HOME = tempConfigHome;
	delete process.env.OTTO_DICTATION_PROMPT;
	await rm(tempConfigHome, { recursive: true, force: true });
	await rm(tempProjectRoot, { recursive: true, force: true });
	await mkdir(tempConfigHome, { recursive: true });
	await mkdir(tempProjectRoot, { recursive: true });
});

afterEach(async () => {
	if (originalXdgConfigHome === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
	}
	if (originalEnvPrompt === undefined) {
		delete process.env.OTTO_DICTATION_PROMPT;
	} else {
		process.env.OTTO_DICTATION_PROMPT = originalEnvPrompt;
	}
	await rm(tempConfigHome, { recursive: true, force: true });
	await rm(tempProjectRoot, { recursive: true, force: true });
});

describe('resolveDictationPrompt', () => {
	test('falls back to the generic base prompt', async () => {
		expect(await resolveDictationPrompt()).toBe(BASE_DICTATION_PROMPT);
	});

	test('prefers the session prompt over everything else', async () => {
		process.env.OTTO_DICTATION_PROMPT = 'env prompt';
		expect(await resolveDictationPrompt({ prompt: '  session prompt  ' })).toBe(
			'session prompt',
		);
	});

	test('uses OTTO_DICTATION_PROMPT when no session prompt is set', async () => {
		process.env.OTTO_DICTATION_PROMPT = 'env prompt';
		expect(await resolveDictationPrompt({ prompt: '' })).toBe('env prompt');
	});

	test('appends vocabulary derived from the project', async () => {
		await writeFile(
			join(tempProjectRoot, 'package.json'),
			JSON.stringify({ name: '@acme/rocketship' }),
		);
		const prompt = await resolveDictationPrompt({
			projectRoot: tempProjectRoot,
		});
		expect(prompt).toStartWith(BASE_DICTATION_PROMPT);
		expect(prompt).toContain('rocketship');
		expect(prompt).toContain('acme');
		expect(prompt).toContain('otto-dictation-prompt-project');
		expect(prompt).toContain('TypeScript');
	});

	test('derives vocabulary from the folder name without package.json', async () => {
		const prompt = await resolveDictationPrompt({
			projectRoot: tempProjectRoot,
		});
		expect(prompt).toContain('otto-dictation-prompt-project');
		expect(prompt).not.toContain('TypeScript');
	});

	test('detects language terms from manifest files', async () => {
		await writeFile(join(tempProjectRoot, 'Cargo.toml'), '[package]\n');
		await writeFile(join(tempProjectRoot, 'go.mod'), 'module example\n');
		const prompt = await resolveDictationPrompt({
			projectRoot: tempProjectRoot,
		});
		expect(prompt).toContain('Rust');
		expect(prompt).toContain('Go');
		expect(prompt).not.toContain('TypeScript');
	});

	test('appends project vocabulary to a project prompt override', async () => {
		const projectPromptPath = getProjectDictationPromptPath(tempProjectRoot);
		await mkdir(dirname(projectPromptPath), { recursive: true });
		await writeFile(projectPromptPath, 'project vocab\n');
		const prompt = await resolveDictationPrompt({
			projectRoot: tempProjectRoot,
		});
		expect(prompt).toStartWith('project vocab');
		expect(prompt).toContain('otto-dictation-prompt-project');
	});

	test('reads the global prompt.txt vocabulary file', async () => {
		const promptPath = getDictationPromptPath();
		await mkdir(dirname(promptPath), { recursive: true });
		await writeFile(promptPath, 'global vocab\n');
		expect(await resolveDictationPrompt()).toBe('global vocab');
	});

	test('ignores an empty global prompt.txt file', async () => {
		const promptPath = getDictationPromptPath();
		await mkdir(dirname(promptPath), { recursive: true });
		await writeFile(promptPath, '   \n');
		expect(await resolveDictationPrompt()).toBe(BASE_DICTATION_PROMPT);
	});

	test('appends user keywords to the selected prompt', async () => {
		expect(
			await resolveDictationPrompt({
				prompt: 'custom prompt',
				keywords: [{ keyword: 'AcmeDB', aliases: ['acme database'] }],
			}),
		).toBe('custom prompt Vocabulary: AcmeDB.');
	});

	test('excludes detected terms without excluding explicit user keywords', async () => {
		await writeFile(join(tempProjectRoot, 'Cargo.toml'), '[package]\n');
		const prompt = await resolveDictationPrompt({
			projectRoot: tempProjectRoot,
			excludedProjectKeywords: ['Rust', 'otto-dictation-prompt-project'],
			keywords: [{ keyword: 'Rust' }],
		});
		expect(prompt).toContain('Vocabulary: Cargo, crate, Rust.');
		expect(prompt).not.toContain('otto-dictation-prompt-project');
	});

	test('has no hardcoded product vocabulary', async () => {
		expect(BASE_DICTATION_PROMPT).not.toContain('OttoCode');
		expect(mergeDictationKeywords()).toEqual([]);
		expect(await deriveProjectVocabulary(tempProjectRoot)).not.toContain(
			'OttoCode',
		);
	});
});

describe('applyDictationKeywordAliases', () => {
	test('corrects user-provided aliases', () => {
		expect(
			applyDictationKeywordAliases(
				'Use autocode, then open the auto   code repository.',
				[
					{
						keyword: 'OttoCode',
						aliases: ['autocode', 'auto code'],
					},
				],
			),
		).toBe('Use OttoCode, then open the OttoCode repository.');
	});

	test('matches aliases case-insensitively without replacing substrings', () => {
		expect(
			applyDictationKeywordAliases('ACME database and acme databases', [
				{ keyword: 'AcmeDB', aliases: ['acme database'] },
			]),
		).toBe('AcmeDB and acme databases');
	});

	test('treats spaces and hyphens in aliases as equivalent', () => {
		expect(
			applyDictationKeywordAliases('Open autocode, auto code, and auto-code.', [
				{ keyword: 'OttoCode', aliases: ['autocode', 'auto-code'] },
			]),
		).toBe('Open OttoCode, OttoCode, and OttoCode.');
	});

	test('merges duplicate user keywords and preserves alias precedence', () => {
		const keywords = mergeDictationKeywords([
			{ keyword: 'OttoCode', aliases: ['autocode', 'auto code'] },
			{ keyword: 'ottocode', aliases: ['otto project'] },
			{ keyword: 'OtherCode', aliases: ['autocode'] },
		]);
		expect(keywords.find(({ keyword }) => keyword === 'OttoCode')).toEqual({
			keyword: 'OttoCode',
			aliases: ['autocode', 'auto code', 'otto project'],
		});
		expect(
			applyDictationKeywordAliases('autocode and otto project', keywords),
		).toBe('OttoCode and OttoCode');
	});
});
