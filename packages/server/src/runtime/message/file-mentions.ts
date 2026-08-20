import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { rememberFileRead } from '@ottocode/sdk/tools/builtin/fs';

const FILE_MENTION_REGEX = /(^|[\s([{])@(\S+)/g;
const TRAILING_PUNCTUATION_REGEX = /[.,!?;:)}\]]+$/;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

export type FileMentionPreprocessResult = {
	text: string;
	mentionedFiles: Array<{
		path: string;
		content: string;
		truncated: boolean;
		size: number;
	}>;
};

export type ResolvedFileMention = {
	path: string;
	size: number;
};

function isPathInsideRoot(path: string, root: string): boolean {
	const relativePath = relative(root, path);
	return (
		relativePath === '' ||
		(!relativePath.startsWith('..') && !isAbsolute(relativePath))
	);
}

function resolveMentionPath(projectRoot: string, mentionPath: string) {
	const root = resolve(projectRoot);
	const absolutePath = isAbsolute(mentionPath)
		? resolve(mentionPath)
		: resolve(root, mentionPath);
	if (!isPathInsideRoot(absolutePath, root)) return undefined;
	return {
		absolutePath,
		relativePath: relative(root, absolutePath) || '.',
	};
}

function extractMentionTokens(text: string): Array<{
	token: string;
	mentionPath: string;
	trailing: string;
}> {
	const mentions: Array<{
		token: string;
		mentionPath: string;
		trailing: string;
	}> = [];
	for (const match of text.matchAll(FILE_MENTION_REGEX)) {
		const token = match[2];
		if (!token) continue;
		const { mentionPath, trailing } = stripTrailingPunctuation(token);
		if (mentionPath) mentions.push({ token, mentionPath, trailing });
	}
	return mentions;
}

export async function resolveFileMentionReferences(args: {
	text: string;
	projectRoot?: string;
	maxFileBytes?: number;
	maxTotalBytes?: number;
}): Promise<ResolvedFileMention[]> {
	const projectRoot = args.projectRoot?.trim();
	if (!projectRoot || !args.text.includes('@')) return [];
	const maxFileBytes = args.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const maxTotalBytes = args.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
	const candidates = await Promise.all(
		extractMentionTokens(args.text).map(async ({ mentionPath }) => {
			const resolved = resolveMentionPath(projectRoot, mentionPath);
			if (!resolved) return;
			const fileStat = await stat(resolved.absolutePath).catch(() => undefined);
			if (!fileStat?.isFile()) return;
			return { path: resolved.relativePath, size: fileStat.size };
		}),
	);
	const seen = new Set<string>();
	const resolved: ResolvedFileMention[] = [];
	let totalBytes = 0;
	for (const candidate of candidates) {
		if (!candidate || seen.has(candidate.path)) continue;
		seen.add(candidate.path);
		if (candidate.size > maxFileBytes) continue;
		if (totalBytes + candidate.size > maxTotalBytes) continue;
		resolved.push(candidate);
		totalBytes += candidate.size;
	}
	return resolved;
}

function stripTrailingPunctuation(token: string) {
	const trailing = token.match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '';
	return {
		mentionPath: trailing ? token.slice(0, -trailing.length) : token,
		trailing,
	};
}

async function readMentionedTextFile(args: {
	projectRoot: string;
	mentionPath: string;
	remainingBytes: number;
	maxFileBytes: number;
}) {
	const resolved = resolveMentionPath(args.projectRoot, args.mentionPath);
	if (!resolved) return undefined;
	const fileStat = await stat(resolved.absolutePath).catch(() => undefined);
	if (!fileStat?.isFile()) return undefined;

	const readLimit = Math.max(
		0,
		Math.min(args.remainingBytes, args.maxFileBytes),
	);
	if (readLimit <= 0) {
		return {
			absolutePath: resolved.absolutePath,
			path: resolved.relativePath,
			content: '',
			truncated: true,
			size: fileStat.size,
		};
	}

	const file = Bun.file(resolved.absolutePath);
	const bytes = new Uint8Array(await file.slice(0, readLimit).arrayBuffer());
	try {
		const content = TEXT_DECODER.decode(bytes);
		return {
			absolutePath: resolved.absolutePath,
			path: resolved.relativePath,
			content,
			truncated: fileStat.size > readLimit,
			size: fileStat.size,
		};
	} catch {
		return undefined;
	}
}

export async function preprocessFileMentionsForModel(args: {
	text: string;
	projectRoot?: string;
	maxFileBytes?: number;
	maxTotalBytes?: number;
	preloadedPaths?: string[];
}): Promise<FileMentionPreprocessResult> {
	const projectRoot = args.projectRoot?.trim();
	if (!projectRoot || !args.text.includes('@')) {
		return { text: args.text, mentionedFiles: [] };
	}

	const mentions: Array<{
		fullMatch: string;
		prefix: string;
		token: string;
		mentionPath: string;
		trailing: string;
	}> = [];
	for (const match of args.text.matchAll(FILE_MENTION_REGEX)) {
		const token = match[2];
		if (!token) continue;
		const { mentionPath, trailing } = stripTrailingPunctuation(token);
		if (!mentionPath) continue;
		mentions.push({
			fullMatch: match[0],
			prefix: match[1] ?? '',
			token,
			mentionPath,
			trailing,
		});
	}
	if (mentions.length === 0) return { text: args.text, mentionedFiles: [] };

	const maxFileBytes = args.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const maxTotalBytes = args.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
	const mentionedFiles: FileMentionPreprocessResult['mentionedFiles'] = [];
	const seen = new Set<string>();
	const preloadedPaths = new Set(args.preloadedPaths ?? []);
	let remainingBytes = maxTotalBytes;
	const replaceByToken = new Map<string, string>();

	for (const mention of mentions) {
		const resolved = resolveMentionPath(projectRoot, mention.mentionPath);
		if (resolved && preloadedPaths.has(resolved.relativePath)) {
			replaceByToken.set(
				mention.token,
				`${mention.mentionPath}${mention.trailing}`,
			);
			continue;
		}
		const file = await readMentionedTextFile({
			projectRoot,
			mentionPath: mention.mentionPath,
			remainingBytes,
			maxFileBytes,
		});
		if (!file) continue;

		replaceByToken.set(
			mention.token,
			`${mention.mentionPath}${mention.trailing}`,
		);
		if (seen.has(file.path)) continue;
		seen.add(file.path);
		const { absolutePath, ...mentionedFile } = file;
		mentionedFiles.push(mentionedFile);
		await rememberFileRead(projectRoot, absolutePath);
		remainingBytes -= Buffer.byteLength(file.content, 'utf8');
	}

	const cleanedText = args.text.replace(
		FILE_MENTION_REGEX,
		(match, prefix: string, token: string) => {
			const replacement = replaceByToken.get(token);
			return replacement ? `${prefix}${replacement}` : match;
		},
	);
	if (mentionedFiles.length === 0) {
		return { text: cleanedText, mentionedFiles: [] };
	}
	const fileBlocks = mentionedFiles.map((file) => {
		const metadata = [
			`path="${file.path}"`,
			`bytes="${file.size}"`,
			file.truncated ? 'truncated="true"' : undefined,
		]
			.filter(Boolean)
			.join(' ');
		const truncationNote = file.truncated
			? '\n\n[File content truncated to stay within prompt budget.]'
			: '';
		return `<mentioned-file ${metadata}>\n${file.content}${truncationNote}\n</mentioned-file>`;
	});

	return {
		text: `${cleanedText}\n\n${fileBlocks.join('\n\n')}`,
		mentionedFiles,
	};
}
