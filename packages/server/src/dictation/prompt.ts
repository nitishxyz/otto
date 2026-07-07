import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getDictationDir } from './paths.ts';

/**
 * Generic base prompt passed to whisper.cpp. Whisper biases decoding
 * toward the vocabulary and style of this text, which fixes common
 * misrecognitions of technical terms. Project-specific vocabulary is
 * appended at resolve time from the active project.
 */
export const BASE_DICTATION_PROMPT =
	'A software developer dictating notes about a codebase. ' +
	'Vocabulary: monorepo, repo, CLI, SDK, API, UI, UX, JSON, YAML, ' +
	'frontend, backend, endpoint, schema, refactor, lint, changelog, ' +
	'commit, PR, diff, middleware, async, config, env var.';

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
 * Global user-editable vocabulary file. Its contents replace the built-in
 * base prompt when present.
 */
export function getDictationPromptPath(): string {
	return join(getDictationDir(), 'prompt.txt');
}

/**
 * Project-level vocabulary file. Its contents replace the built-in base
 * prompt for dictation sessions created in that project.
 */
export function getProjectDictationPromptPath(projectRoot: string): string {
	return join(projectRoot, '.otto', 'dictation-prompt.txt');
}

export type ResolveDictationPromptInput = {
	prompt?: string;
	projectRoot?: string;
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
	const fromSession = input.prompt?.trim();
	if (fromSession) return fromSession;

	const fromEnv = process.env.OTTO_DICTATION_PROMPT?.trim();
	if (fromEnv) return fromEnv;

	if (input.projectRoot) {
		const fromProjectFile = await readPromptFile(
			getProjectDictationPromptPath(input.projectRoot),
		);
		if (fromProjectFile) return fromProjectFile;
	}

	const fromGlobalFile = await readPromptFile(getDictationPromptPath());
	if (fromGlobalFile) return fromGlobalFile;

	const projectTerms = input.projectRoot
		? await deriveProjectVocabulary(input.projectRoot)
		: [];
	if (projectTerms.length === 0) return BASE_DICTATION_PROMPT;
	return `${BASE_DICTATION_PROMPT} Project terms: ${projectTerms.join(', ')}.`;
}

/**
 * Derive vocabulary terms from the project itself so proper nouns like the
 * project or package name are transcribed correctly.
 */
async function deriveProjectVocabulary(projectRoot: string): Promise<string[]> {
	const terms = new Set<string>();

	const dirName = normalizeTerm(basename(projectRoot));
	if (dirName) terms.add(dirName);

	const pkg = await readJsonFile(join(projectRoot, 'package.json'));
	if (typeof pkg?.name === 'string') {
		const pkgName = normalizeTerm(pkg.name.split('/').pop() ?? '');
		if (pkgName) terms.add(pkgName);
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
