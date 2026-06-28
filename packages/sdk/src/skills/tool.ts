import { tool, type Tool } from 'ai';
import { dirname } from 'node:path';
import { z } from 'zod/v3';
import {
	loadSkill,
	discoverSkills,
	findGitRoot,
	loadSkillFile,
	discoverSkillFiles,
} from './loader.ts';
import { scanContent } from './security.ts';
import type { DiscoveredSkill, SkillResult } from './types.ts';
import type { SkillSettings } from '../types/src/config.ts';

let cachedSkillList: DiscoveredSkill[] = [];
let initializedForPath: string | null = null;
let cachedSkillSettings: SkillSettings | undefined;

export async function initializeSkills(
	cwd: string,
	repoRoot?: string,
): Promise<DiscoveredSkill[]> {
	const root = repoRoot ?? (await findGitRoot(cwd)) ?? cwd;
	cachedSkillList = await discoverSkills(cwd, root);
	initializedForPath = cwd;
	return cachedSkillList;
}

export function getDiscoveredSkills(): DiscoveredSkill[] {
	return cachedSkillList;
}

export function setSkillSettings(settings?: SkillSettings): void {
	cachedSkillSettings = settings;
}

export function filterDiscoveredSkills(
	skills: DiscoveredSkill[],
	settings?: {
		enabled?: boolean;
		items?: Record<string, { enabled?: boolean }>;
	},
): DiscoveredSkill[] {
	if (settings?.enabled === false) return [];
	return skills.filter(
		(skill) => settings?.items?.[skill.name]?.enabled !== false,
	);
}

export function isSkillsInitialized(forPath?: string): boolean {
	if (!initializedForPath) return false;
	if (forPath && forPath !== initializedForPath) return false;
	return true;
}

export function buildSkillTool(): { name: string; tool: Tool } {
	const skillTool = tool({
		description: buildSkillDescription(),
		inputSchema: z.object({
			name: z
				.string()
				.describe('The name of the skill from the available skills list'),
			file: z
				.string()
				.optional()
				.describe(
					'Optional relative path within the skill base directory to load a specific supporting file (e.g. "rules/animations.md")',
				),
		}),
		async execute({
			name,
			file,
		}: {
			name: string;
			file?: string;
		}): Promise<SkillResult> {
			if (file) {
				return loadSubFile(name, file);
			}
			return loadMainSkill(name);
		},
	});

	return { name: 'skill', tool: skillTool };
}

async function loadMainSkill(name: string): Promise<SkillResult> {
	const skill = await loadSkill(name);
	if (!skill) {
		return { ok: false, error: `Skill '${name}' not found` };
	}

	const [availableFiles, securityNotices] = await Promise.all([
		discoverSkillFiles(name),
		Promise.resolve(scanContent(skill.content)),
	]);

	return {
		ok: true,
		name: skill.metadata.name,
		description: skill.metadata.description,
		content: skill.content,
		path: skill.path,
		baseDirectory: dirname(skill.path),
		resourceInstructions:
			'Supporting file paths are relative to this baseDirectory. Load a listed file with the skill tool file parameter only when the skill instructions or task make it relevant.',
		scope: skill.scope,
		allowedTools: skill.metadata.allowedTools,
		...(availableFiles.length > 0 && { availableFiles }),
		...(securityNotices.length > 0 && { securityNotices }),
	};
}

async function loadSubFile(
	name: string,
	filePath: string,
): Promise<SkillResult> {
	const skill = await loadSkill(name);
	if (!skill) {
		return { ok: false, error: `Skill '${name}' not found` };
	}

	const result = await loadSkillFile(name, filePath);
	if (!result) {
		const availableFiles = await discoverSkillFiles(name);
		const fileList = availableFiles.map((f) => f.relativePath).join(', ');
		return {
			ok: false,
			error: `File '${filePath}' not found or not readable in skill '${name}'. Available files: ${fileList || 'none'}`,
		};
	}

	const securityNotices = scanContent(result.content);

	return {
		ok: true,
		name: skill.metadata.name,
		description: `Sub-file: ${filePath}`,
		content: result.content,
		path: result.resolvedPath,
		baseDirectory: dirname(skill.path),
		resourceInstructions:
			'This is a supporting file from the skill baseDirectory. Use it together with the main SKILL.md instructions.',
		scope: skill.scope,
		...(securityNotices.length > 0 && { securityNotices }),
	};
}

function buildSkillDescription(): string {
	const enabledSkills = filterDiscoveredSkills(
		cachedSkillList,
		cachedSkillSettings,
	);
	if (enabledSkills.length === 0) {
		return 'Load a specialized skill when the task matches one of the skills listed in the system prompt. No skills are currently available.';
	}

	// Dedupe by name — later scopes (cwd > repo > user) have already overwritten
	// earlier ones in the loader, so the cached list is deduplicated. We re-dedupe
	// defensively here in case the same name slipped through from different dirs.
	const seen = new Set<string>();
	const unique: DiscoveredSkill[] = [];
	for (const s of enabledSkills) {
		const key = s.name.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		unique.push(s);
	}
	unique.sort((a, b) => a.name.localeCompare(b.name));

	const catalog = unique
		.map((s) => `- ${s.name}: ${summarizeDescription(s.description)}`)
		.join('\n');

	return `Load a specialized skill when the task at hand matches one of the skills listed in the system prompt. Use this tool to inject the skill's instructions and supporting resources into the current conversation. The output contains the full SKILL.md content, the skill base directory, and any available supporting files. Load supporting files with the optional file parameter only when relevant. The skill name must match one of these available skills:\n${catalog}`;
}

// Condense a SKILL.md description to "what it does + when to use it".
//
// Most frontmatter follows one of two shapes:
//   A. "<what>. Use when <triggers>. Also use when … For X, see Y."
//   B. "When the user wants X. Also use when <mega trigger list>. For Y, see Z."
//
// Rule: keep up to two sentences, but STOP early at cues that mark pure
// trigger-list expansion or see-also chatter ("Also use when …", "For X, see Y",
// "Use this …"). Sentence 1 is always kept. Sentence 2 is kept only if it's a
// "Use when …" clause (trigger phrases the model actually needs) — not an
// "Also use when" balloon.
const SENTENCE_END = /[.!?]\s/g;
const SKIP_PREFIXES = [
	/^also use when\b/i,
	/^for [^.]*?,?\s*see\b/i,
	/^see\s+/i,
	/^use this\b/i,
	/^use proactively\b/i,
	/^distinct from\b/i,
	/^different from\b/i,
	/^not for\b/i,
];

function shouldSkipSentence(sentence: string): boolean {
	const s = sentence.trim();
	return SKIP_PREFIXES.some((re) => re.test(s));
}

export function summarizeDescription(raw: string): string {
	const text = String(raw ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return '';

	// Split into sentences, keeping terminal punctuation.
	const sentences: string[] = [];
	SENTENCE_END.lastIndex = 0;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
	while ((match = SENTENCE_END.exec(text)) !== null) {
		sentences.push(text.slice(lastIndex, match.index + 1).trim());
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) sentences.push(text.slice(lastIndex).trim());

	if (sentences.length === 0) return text;

	const kept: string[] = [sentences[0]]; // always keep sentence 1 (what)
	// Keep sentence 2 only if it adds routing signal (e.g. starts with "Use when").
	if (sentences[1] && !shouldSkipSentence(sentences[1])) {
		kept.push(sentences[1]);
	}

	return kept.join(' ');
}

export function rebuildSkillDescription(): string {
	return buildSkillDescription();
}
