import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DictationKeyword } from '@ottocode/sdk';
import { getDictationDir } from './paths.ts';

/**
 * Generic context passed to whisper.cpp. Project and user vocabulary is
 * appended at resolve time rather than being hardcoded here.
 */
export const BASE_DICTATION_PROMPT =
	'A software developer dictating notes about a codebase.';

/**
 * Manifest files that indicate which language ecosystems a project uses.
 * Terms are only appended when the corresponding manifest exists, so the
 * prompt reflects the actual project instead of assuming a stack.
 */
const LANGUAGE_MARKERS: Array<{ file: string; terms: string[] }> = [
	{ file: 'package.json', terms: ['TypeScript', 'JavaScript', 'npm'] },
	{ file: 'tsconfig.json', terms: ['TypeScript'] },
	{ file: 'bun.lock', terms: ['Bun'] },
	{ file: 'bun.lockb', terms: ['Bun'] },
	{ file: 'deno.json', terms: ['Deno'] },
	{ file: 'Cargo.toml', terms: ['Rust', 'Cargo', 'crate'] },
	{ file: 'go.mod', terms: ['Go', 'goroutine'] },
	{ file: 'pyproject.toml', terms: ['Python', 'pip'] },
	{ file: 'requirements.txt', terms: ['Python', 'pip'] },
	{ file: 'Gemfile', terms: ['Ruby', 'gem'] },
	{ file: 'composer.json', terms: ['PHP', 'Composer'] },
	{ file: 'pom.xml', terms: ['Java', 'Maven'] },
	{ file: 'build.gradle', terms: ['Java', 'Kotlin', 'Gradle'] },
	{ file: 'build.gradle.kts', terms: ['Kotlin', 'Gradle'] },
	{ file: 'Package.swift', terms: ['Swift'] },
	{ file: 'pubspec.yaml', terms: ['Dart', 'Flutter'] },
	{ file: 'mix.exs', terms: ['Elixir', 'Mix'] },
	{ file: 'CMakeLists.txt', terms: ['C++', 'CMake'] },
	{ file: 'Dockerfile', terms: ['Docker'] },
];

/**
 * Global user-editable prompt file. Its contents replace the generic prompt.
 */
export function getDictationPromptPath(): string {
	return join(getDictationDir(), 'prompt.txt');
}

/**
 * Project-level prompt file for dictation sessions created in that project.
 */
export function getProjectDictationPromptPath(projectRoot: string): string {
	return join(projectRoot, '.otto', 'dictation-prompt.txt');
}

export type ResolveDictationPromptInput = {
	prompt?: string;
	projectRoot?: string;
	keywords?: DictationKeyword[];
	excludedProjectKeywords?: string[];
};

/**
 * Resolve the initial prompt for a dictation transcription.
 * Precedence: session prompt > OTTO_DICTATION_PROMPT env >
 * project .otto/dictation-prompt.txt > global prompt.txt >
 * base prompt plus vocabulary derived from the project.
 */
export async function resolveDictationPrompt(
	input: ResolveDictationPromptInput = {},
): Promise<string> {
	const keywords = mergeDictationKeywords(input.keywords);
	let prompt: string;
	const fromSession = input.prompt?.trim();
	const fromEnv = process.env.OTTO_DICTATION_PROMPT?.trim();
	if (fromSession) {
		prompt = fromSession;
	} else if (fromEnv) {
		prompt = fromEnv;
	} else if (input.projectRoot) {
		const fromProjectFile = await readPromptFile(
			getProjectDictationPromptPath(input.projectRoot),
		);
		prompt = fromProjectFile ?? (await resolveGlobalPrompt());
	} else {
		prompt = await resolveGlobalPrompt();
	}

	const projectTerms = input.projectRoot
		? await deriveProjectVocabulary(input.projectRoot)
		: [];
	const excludedProjectKeywords = new Set(
		(input.excludedProjectKeywords ?? []).map((term) =>
			term.trim().toLocaleLowerCase(),
		),
	);
	return appendVocabulary(prompt, [
		...projectTerms.filter(
			(term) => !excludedProjectKeywords.has(term.toLocaleLowerCase()),
		),
		...keywords.map(({ keyword }) => keyword),
	]);
}

export function mergeDictationKeywords(
	customKeywords: readonly DictationKeyword[] = [],
): DictationKeyword[] {
	return normalizeDictationKeywords(customKeywords);
}

export function normalizeDictationKeywords(
	keywords: readonly DictationKeyword[],
): DictationKeyword[] {
	const normalized = new Map<string, DictationKeyword>();
	for (const entry of keywords) {
		const keyword = entry.keyword.trim().replace(/\s+/g, ' ');
		if (!keyword || keyword.length > 80) continue;
		const normalizedKeyword = keyword.toLocaleLowerCase();
		const existing = normalized.get(normalizedKeyword);
		const aliases = Array.from(
			new Set(
				[...(existing?.aliases ?? []), ...(entry.aliases ?? [])]
					.map((alias) => alias.trim().replace(/\s+/g, ' '))
					.filter(
						(alias) =>
							alias &&
							alias.length <= 80 &&
							alias.toLocaleLowerCase() !== keyword.toLocaleLowerCase(),
					),
			),
		).slice(0, 12);
		normalized.set(normalizedKeyword, {
			keyword: existing?.keyword ?? keyword,
			aliases,
		});
	}
	return Array.from(normalized.values()).slice(0, 100);
}

export function applyDictationKeywordAliases(
	text: string,
	keywords: readonly DictationKeyword[],
): string {
	const replacements = new Map<string, string>();
	const aliasPatterns = new Map<string, string>();
	for (const { keyword, aliases = [] } of keywords) {
		for (const alias of aliases) {
			const normalizedAlias = normalizeAlias(alias);
			if (!normalizedAlias || normalizedAlias === normalizeAlias(keyword)) {
				continue;
			}
			const owner = replacements.get(normalizedAlias);
			if (!owner) {
				replacements.set(normalizedAlias, keyword);
			}
			if (owner && owner !== keyword) continue;
			const aliasPattern = escapeRegExp(alias.trim()).replace(
				/[ -]+/g,
				'[\\s-]*',
			);
			const existingPattern = aliasPatterns.get(normalizedAlias);
			aliasPatterns.set(
				normalizedAlias,
				existingPattern
					? `(?:${existingPattern}|${aliasPattern})`
					: aliasPattern,
			);
		}
	}
	if (replacements.size === 0) return text;

	const alternatives = Array.from(aliasPatterns.values())
		.sort((a, b) => b.length - a.length)
		.filter(Boolean);
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`,
		'giu',
	);
	return text.replace(
		pattern,
		(match) => replacements.get(normalizeAlias(match)) ?? match,
	);
}

async function resolveGlobalPrompt(): Promise<string> {
	const fromGlobalFile = await readPromptFile(getDictationPromptPath());
	return fromGlobalFile ?? BASE_DICTATION_PROMPT;
}

function appendVocabulary(
	prompt: string,
	vocabulary: readonly string[],
): string {
	const promptLower = prompt.toLocaleLowerCase();
	const additions = Array.from(
		new Set(vocabulary.map((term) => term.trim())),
	).filter((term) => term && !promptLower.includes(term.toLocaleLowerCase()));
	return additions.length === 0
		? prompt
		: `${prompt} Vocabulary: ${additions.join(', ')}.`;
}

function normalizeAlias(value: string): string {
	return value
		.trim()
		.replace(/[\s-]+/g, '')
		.toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive vocabulary terms from the project itself so proper nouns like the
 * project or package name are transcribed correctly.
 */
export async function deriveProjectVocabulary(
	projectRoot: string,
): Promise<string[]> {
	const terms = new Set<string>();

	const dirName = normalizeTerm(basename(projectRoot));
	if (dirName) terms.add(dirName);

	const pkg = await readJsonFile(join(projectRoot, 'package.json'));
	if (typeof pkg?.name === 'string') {
		for (const part of pkg.name.replace(/^@/, '').split('/')) {
			const pkgName = normalizeTerm(part);
			if (pkgName) terms.add(pkgName);
		}
	}

	for (const languageTerm of await detectLanguageTerms(projectRoot)) {
		terms.add(languageTerm);
	}

	return Array.from(terms).slice(0, 16);
}

async function detectLanguageTerms(projectRoot: string): Promise<string[]> {
	const terms = new Set<string>();
	await Promise.all(
		LANGUAGE_MARKERS.map(async (marker) => {
			if (await fileExists(join(projectRoot, marker.file))) {
				for (const term of marker.terms) terms.add(term);
			}
		}),
	);
	return Array.from(terms);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function normalizeTerm(value: string): string {
	const cleaned = value.replace(/[^\w.-]/g, '').trim();
	if (cleaned.length < 2 || cleaned.length > 40) return '';
	return cleaned;
}

async function readPromptFile(path: string): Promise<string | null> {
	try {
		const text = await readFile(path, 'utf8');
		return text.trim() || null;
	} catch {
		return null;
	}
}

async function readJsonFile(
	path: string,
): Promise<Record<string, unknown> | null> {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8'));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
