import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';

export type PatchChangeKind = 'add' | 'delete' | 'update' | 'rename';

/**
 * FNV-1a 32-bit. Cheap enough to run on every normalize pass and stable across
 * reloads, which is what Pierre's worker AST cache keys need. Not cryptographic
 * and not used for anything security-sensitive.
 */
export function contentHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/** Per-hunk ranges/stats used for the existing hunk chip design. */
export interface NormalizedHunkStat {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	additions: number;
	deletions: number;
	context?: string;
}

export interface NormalizedPatchFile {
	/** Stable identity for React keys; unique within one tool call. */
	id: string;
	/** Repository-relative path of the file the operation touches. */
	path: string;
	/** Previous path for renames, when the payload provides one. */
	previousPath?: string;
	kind: PatchChangeKind;
	/** A singular git-style unified patch describing exactly this file. */
	patch: string;
	/**
	 * The operation's own source text. Rendered verbatim (with +/- colouring)
	 * when `renderable` is false, so no operation is ever silently dropped.
	 */
	text: string;
	/**
	 * True when `patch` resolves to a Pierre model with real content. False for
	 * custom envelopes that cannot be expressed as a unified diff (for example
	 * `*** Find:`/`*** With:` blocks) and for pure renames with no hunks.
	 */
	renderable: boolean;
	/**
	 * Parsed once here so renderers never feed the patch string back through a
	 * second parse. Carries a stable `cacheKey` so the worker AST cache survives
	 * collapse/reopen. `undefined` exactly when `renderable` is false.
	 */
	fileDiff?: FileDiffMetadata;
	additions: number;
	deletions: number;
	hunks: NormalizedHunkStat[];
}

const GIT_FILE_HEADER = /^diff --git /m;
const GIT_FILE_BREAK = /(?=^diff --git )/m;
const UNIFIED_FILE_HEADER = /^--- \S/m;
const UNIFIED_FILE_BREAK = /(?=^--- \S)/m;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
const ENVELOPE_BEGIN = /^\*\*\* Begin Patch\s*$/m;
const JSDIFF_SEPARATOR = /^={10,}$/;

/**
 * Every directive that starts a new per-file operation in Otto's envelope
 * grammar. `Add|Update|Delete File` are the normalized artifact forms; the rest
 * appear in raw tool arguments (approval cards, failed patches).
 */
const ENVELOPE_OPERATION =
	/^\*\*\* (Add File|Update File|Delete File|Replace in|Delete Lines in|Replace Lines in|Insert Before in|Insert After in): (.+)$/;
const ENVELOPE_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const ENVELOPE_BOUNDARY = /^\*\*\* (Begin|End) Patch\s*$/;

/** Directives that describe an edit Pierre cannot model as a unified diff. */
const NON_DIFF_OPERATIONS = new Set([
	'Replace in',
	'Delete Lines in',
	'Replace Lines in',
	'Insert Before in',
	'Insert After in',
]);

/** Strips leading `./`, leading slashes and jsdiff's `a/` / `b/` prefixes. */
export function toPatchPath(filePath: string): string {
	const normalized = filePath
		.trim()
		.replace(/\t.*$/, '')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '');
	return normalized || 'file';
}

function stripSidePrefix(filePath: string): string {
	return toPatchPath(filePath).replace(/^[ab]\//, '');
}

function withTrailingNewline(value: string): string {
	return value.replace(/\n*$/, '\n');
}

function buildHeader(path: string, kind: PatchChangeKind): string {
	if (kind === 'add') {
		return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n`;
	}
	if (kind === 'delete') {
		return `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n`;
	}
	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
}

interface HunkBlock {
	header: string;
	lines: string[];
}

function isHunkContentLine(line: string): boolean {
	return (
		line.startsWith('+') ||
		line.startsWith('-') ||
		line.startsWith(' ') ||
		line === '' ||
		line.startsWith('\\')
	);
}

/**
 * Splits a hunk body into blocks. Returns `null` when the body contains
 * anything that is not a hunk header or a hunk content line, which is how
 * non-diff envelope directives are rejected before reaching the diff renderer.
 */
function collectHunks(lines: string[]): HunkBlock[] | null {
	const hunks: HunkBlock[] = [];
	let current: HunkBlock | null = null;

	for (const line of lines) {
		if (line.startsWith('@@')) {
			current = { header: line, lines: [] };
			hunks.push(current);
			continue;
		}
		if (!current) {
			if (line.trim() === '') continue;
			return null;
		}
		if (!isHunkContentLine(line)) return null;
		current.lines.push(line);
	}

	return hunks.length > 0 ? hunks : null;
}

function formatRange(start: number, count: number): string {
	return count === 1 ? `${start}` : `${start},${count}`;
}

interface NormalizedHunk {
	header: string;
	stat: NormalizedHunkStat;
}

/**
 * Rewrites a hunk header so it always carries explicit line ranges, and derives
 * its stats from the actual lines. Tool payloads sometimes emit a bare `@@`
 * marker or stale counts, neither of which `@pierre/diffs` can use.
 */
function normalizeHunk(
	hunk: HunkBlock,
	oldStart: number,
	newStart: number,
): NormalizedHunk {
	let oldLines = 0;
	let newLines = 0;
	let additions = 0;
	let deletions = 0;
	for (const line of hunk.lines) {
		if (line.startsWith('\\')) continue;
		if (line.startsWith('+')) {
			newLines += 1;
			additions += 1;
		} else if (line.startsWith('-')) {
			oldLines += 1;
			deletions += 1;
		} else {
			oldLines += 1;
			newLines += 1;
		}
	}

	const parsed = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(
		hunk.header,
	);
	const resolvedOldStart = parsed ? Number.parseInt(parsed[1], 10) : oldStart;
	const resolvedNewStart = parsed ? Number.parseInt(parsed[3], 10) : newStart;
	const context = parsed?.[5]?.trim() || undefined;

	return {
		header: `@@ -${formatRange(resolvedOldStart, oldLines)} +${formatRange(
			resolvedNewStart,
			newLines,
		)} @@${parsed?.[5] ?? ''}`,
		stat: {
			oldStart: resolvedOldStart,
			oldLines,
			newStart: resolvedNewStart,
			newLines,
			additions,
			deletions,
			context,
		},
	};
}

interface BuiltBody {
	body: string;
	stats: NormalizedHunkStat[];
	additions: number;
	deletions: number;
}

function buildPatchBody(hunks: HunkBlock[], kind: PatchChangeKind): BuiltBody {
	let oldCursor = kind === 'add' ? 0 : 1;
	let newCursor = kind === 'delete' ? 0 : 1;
	const out: string[] = [];
	const stats: NormalizedHunkStat[] = [];
	let additions = 0;
	let deletions = 0;

	for (const hunk of hunks) {
		const normalized = normalizeHunk(hunk, oldCursor, newCursor);
		out.push(normalized.header, ...hunk.lines);
		stats.push(normalized.stat);
		additions += normalized.stat.additions;
		deletions += normalized.stat.deletions;
		oldCursor += normalized.stat.oldLines;
		newCursor += normalized.stat.newLines;
	}

	return {
		body: withTrailingNewline(out.join('\n')),
		stats,
		additions,
		deletions,
	};
}

/** Counts raw +/- lines, used for operations with no parseable hunks. */
function countRawChanges(lines: string[]): {
	additions: number;
	deletions: number;
} {
	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		if (line.startsWith('+')) additions += 1;
		else if (line.startsWith('-')) deletions += 1;
	}
	return { additions, deletions };
}

/**
 * Rewrites a non-diff envelope body so the fallback still reads as a diff:
 * `*** Find:` blocks become `-` lines and `*** With:` blocks become `+` lines.
 * Exact line numbers are unknown, which is precisely why these operations
 * cannot be handed to Pierre.
 */
function toDisplayLines(directive: string, body: string[]): string[] {
	const out: string[] = [];
	let phase: 'none' | 'find' | 'with' = 'none';

	for (const line of body) {
		if (/^\*\*\* Find:\s*$/.test(line)) {
			phase = 'find';
			continue;
		}
		if (/^\*\*\* With:\s*$/.test(line)) {
			phase = 'with';
			continue;
		}
		if (/^\*\*\* (Lines|Line):/.test(line)) {
			out.push(line);
			continue;
		}
		if (phase === 'find') out.push(`-${line}`);
		else if (phase === 'with') out.push(`+${line}`);
		else if (line.trim() !== '') out.push(line);
	}

	// `Delete Lines in` names a range but never carries its content.
	if (directive === 'Delete Lines in' && out.length === 0) return body;
	return out;
}

function makeFile(
	index: number,
	path: string,
	kind: PatchChangeKind,
	patch: string,
	text: string,
	stats: NormalizedHunkStat[],
	additions: number,
	deletions: number,
	previousPath?: string,
): NormalizedPatchFile {
	const fileDiff = patch.length > 0 ? parseSingularFileDiff(patch) : undefined;
	return {
		// Content-derived so the identity is stable across rerenders and changes
		// when the operation's content changes.
		id: `${index}:${kind}:${path}:${contentHash(patch || text)}`,
		path,
		previousPath,
		kind,
		patch,
		text,
		renderable: fileDiff !== undefined,
		fileDiff,
		additions,
		deletions,
		hunks: stats,
	};
}

/** Builds a non-renderable entry that falls back to its own source text. */
function makeTextFile(
	index: number,
	path: string,
	kind: PatchChangeKind,
	text: string,
	previousPath?: string,
): NormalizedPatchFile {
	const counts = countRawChanges(text.split('\n'));
	return {
		id: `${index}:${kind}:${path}:${contentHash(text)}`,
		path,
		previousPath,
		kind,
		patch: '',
		text,
		renderable: false,
		fileDiff: undefined,
		additions: counts.additions,
		deletions: counts.deletions,
		hunks: [],
	};
}

interface EnvelopeSection {
	directive: string;
	path: string;
	body: string[];
}

/**
 * Splits an Otto envelope into its ordered per-file sections. Every operation
 * is preserved, including ones that cannot be expressed as a unified diff.
 */
function splitEnvelopeSections(patch: string): EnvelopeSection[] {
	const sections: EnvelopeSection[] = [];
	let current: EnvelopeSection | null = null;

	for (const line of patch.split('\n')) {
		const match = ENVELOPE_OPERATION.exec(line);
		if (match) {
			current = {
				directive: match[1],
				path: stripSidePrefix(match[2]),
				body: [],
			};
			sections.push(current);
			continue;
		}
		if (ENVELOPE_BOUNDARY.test(line)) {
			current = null;
			continue;
		}
		if (current) current.body.push(line);
	}

	return sections;
}

function directiveKind(directive: string): PatchChangeKind {
	if (directive === 'Add File') return 'add';
	if (directive === 'Delete File') return 'delete';
	return 'update';
}

/**
 * Converts Otto's enveloped patch format into one entry per file operation,
 * in source order. Operations using non-diff directives keep a text fallback
 * rather than being dropped.
 */
function normalizeEnvelopedPatch(patch: string): NormalizedPatchFile[] {
	return splitEnvelopeSections(patch).map((section, index) => {
		const kind = directiveKind(section.directive);

		if (NON_DIFF_OPERATIONS.has(section.directive)) {
			return makeTextFile(
				index,
				section.path,
				kind,
				toDisplayLines(section.directive, section.body)
					.join('\n')
					.replace(/\n+$/, ''),
			);
		}

		const sourceText = section.body.join('\n').replace(/\n+$/, '');

		const hunks = collectHunks(section.body);
		if (!hunks) return makeTextFile(index, section.path, kind, sourceText);

		const built = buildPatchBody(hunks, kind);
		return makeFile(
			index,
			section.path,
			kind,
			buildHeader(section.path, kind) + built.body,
			sourceText,
			built.stats,
			built.additions,
			built.deletions,
		);
	});
}

function inferGitPatchKind(section: string): PatchChangeKind {
	if (/^new file mode /m.test(section) || /^--- \/dev\/null$/m.test(section)) {
		return 'add';
	}
	if (
		/^deleted file mode /m.test(section) ||
		/^\+\+\+ \/dev\/null$/m.test(section)
	) {
		return 'delete';
	}
	if (/^rename from /m.test(section) && !HUNK_HEADER.test(section)) {
		return 'rename';
	}
	return 'update';
}

function gitSectionPaths(section: string): {
	path: string;
	previousPath?: string;
} {
	const header = section.slice(0, section.indexOf('\n'));
	const renameTo = /^rename to (.+)$/m.exec(section);
	const renameFrom = /^rename from (.+)$/m.exec(section);
	const match = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(header);

	const previousPath = renameFrom ? stripSidePrefix(renameFrom[1]) : undefined;
	if (renameTo) return { path: stripSidePrefix(renameTo[1]), previousPath };
	if (match) {
		return { path: stripSidePrefix(match[2] || match[1]), previousPath };
	}
	const plus = /^\+\+\+ (?!\/dev\/null)(.+)$/m.exec(section);
	if (plus) return { path: stripSidePrefix(plus[1]), previousPath };
	const minus = /^--- (?!\/dev\/null)(.+)$/m.exec(section);
	if (minus) return { path: stripSidePrefix(minus[1]), previousPath };
	return { path: 'file', previousPath };
}

/** Reads hunk stats from an already well-formed unified patch section. */
function statsFromUnifiedSection(section: string): BuiltBody {
	const body = section
		.split('\n')
		.filter(
			(line) =>
				line.startsWith('@@') ||
				(!line.startsWith('diff --git') &&
					!line.startsWith('index ') &&
					!line.startsWith('--- ') &&
					!line.startsWith('+++ ') &&
					!/^(new|deleted|old|new) (file )?mode /.test(line) &&
					!/^(similarity|dissimilarity) index /.test(line) &&
					!/^(rename|copy) (from|to) /.test(line)),
		);
	const hunks = collectHunks(body);
	if (!hunks) {
		return { body: '', stats: [], additions: 0, deletions: 0 };
	}
	// Preserve the section's own headers; only derive the stats.
	const stats: NormalizedHunkStat[] = [];
	let additions = 0;
	let deletions = 0;
	let oldCursor = 1;
	let newCursor = 1;
	for (const hunk of hunks) {
		const normalized = normalizeHunk(hunk, oldCursor, newCursor);
		stats.push(normalized.stat);
		additions += normalized.stat.additions;
		deletions += normalized.stat.deletions;
		oldCursor += normalized.stat.oldLines;
		newCursor += normalized.stat.newLines;
	}
	return { body: '', stats, additions, deletions };
}

function normalizeGitStylePatch(patch: string): NormalizedPatchFile[] {
	return patch
		.split(GIT_FILE_BREAK)
		.filter((section) => section.trim().length > 0)
		.map((section, index) => {
			const { path, previousPath } = gitSectionPaths(section);
			const kind = inferGitPatchKind(section);
			const stats = statsFromUnifiedSection(section);
			const text = section.replace(/\n+$/, '');
			return makeFile(
				index,
				path,
				kind,
				withTrailingNewline(section),
				text,
				stats.stats,
				stats.additions,
				stats.deletions,
				previousPath,
			);
		});
}

/**
 * Normalizes jsdiff `createTwoFilesPatch` output (used by the write/edit/
 * multiedit/copy_into tool artifacts) into git-style patches. jsdiff omits the
 * `diff --git` header, keeps a `====` separator line and pads the file headers
 * with tabs. A single payload may contain several such sections.
 */
function normalizeUnifiedPatch(
	patch: string,
	fallbackPath?: string,
): NormalizedPatchFile[] {
	const cleaned = patch
		.split('\n')
		.filter((line) => !JSDIFF_SEPARATOR.test(line.trim()))
		.join('\n');

	return cleaned
		.split(UNIFIED_FILE_BREAK)
		.filter((section) => section.trim().length > 0)
		.map((section, index) => {
			const lines = section.split('\n');
			const oldHeader = lines.find((line) => line.startsWith('--- '));
			const newHeader = lines.find((line) => line.startsWith('+++ '));
			const rawPath =
				newHeader && !newHeader.startsWith('+++ /dev/null')
					? newHeader.slice(4)
					: oldHeader && !oldHeader.startsWith('--- /dev/null')
						? oldHeader.slice(4)
						: (fallbackPath ?? 'file');
			const path = stripSidePrefix(rawPath);
			const kind: PatchChangeKind = newHeader?.startsWith('+++ /dev/null')
				? 'delete'
				: oldHeader?.startsWith('--- /dev/null')
					? 'add'
					: 'update';

			const body = lines.filter(
				(line) => !line.startsWith('--- ') && !line.startsWith('+++ '),
			);
			const hunks = collectHunks(body);
			const text = section.replace(/\n+$/, '');
			if (!hunks) return makeTextFile(index, path, kind, text);

			const built = buildPatchBody(hunks, kind);
			return makeFile(
				index,
				path,
				kind,
				buildHeader(path, kind) + built.body,
				text,
				built.stats,
				built.additions,
				built.deletions,
			);
		});
}

function normalizeBareHunks(
	patch: string,
	fallbackPath?: string,
): NormalizedPatchFile[] {
	const hunks = collectHunks(patch.split('\n'));
	const path = stripSidePrefix(fallbackPath ?? 'file');
	const text = patch.replace(/\n+$/, '');
	if (!hunks) return [makeTextFile(0, path, 'update', text)];

	const built = buildPatchBody(hunks, 'update');
	return [
		makeFile(
			0,
			path,
			'update',
			buildHeader(path, 'update') + built.body,
			text,
			built.stats,
			built.additions,
			built.deletions,
		),
	];
}

/**
 * Confirms `@pierre/diffs` can actually build a renderable model from a patch:
 * exactly one file with at least one hunk carrying real line content. Anything
 * else would produce an empty diff shell, so callers must fall back instead.
 */
export function isRenderablePierrePatch(patch: string): boolean {
	return parseSingularFileDiff(patch) !== undefined;
}

/**
 * Parses a singular per-file patch into the metadata Pierre renders, using a
 * content-derived cache key so identical content reuses the worker AST cache.
 *
 * Returns `undefined` when the patch would produce an empty diff shell:
 * anything other than exactly one file with at least one hunk carrying real
 * line content.
 */
function parseSingularFileDiff(patch: string): FileDiffMetadata | undefined {
	try {
		// The prefix becomes `<hash>-<patchIndex>-<fileIndex>` on the metadata.
		const parsed = parsePatchFiles(patch, contentHash(patch));
		if (parsed.length !== 1 || parsed[0].files.length !== 1) return undefined;
		const file = parsed[0].files[0];
		if (!file.hunks || file.hunks.length === 0) return undefined;
		const hasContent =
			(file.additionLines?.length ?? 0) > 0 ||
			(file.deletionLines?.length ?? 0) > 0;
		return hasContent ? file : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Converts any patch payload Otto's tools produce into an ordered list of
 * per-file operations. One `apply_patch` call may contain many operations,
 * many files and many hunks per file; every one of them is preserved.
 *
 * Entries with `renderable: false` cannot be expressed as a unified diff and
 * must be rendered from their `text` instead, per file — never by discarding
 * the whole payload.
 */
export function normalizeToolPatch(
	rawPatch: string,
	fallbackPath?: string,
): NormalizedPatchFile[] {
	// Trailing newlines would otherwise be collected as empty context lines and
	// inflate the recomputed hunk ranges.
	const patch = rawPatch.replace(/\r\n/g, '\n').replace(/\n+$/, '');
	if (patch.trim().length === 0) return [];

	if (ENVELOPE_BEGIN.test(patch) || ENVELOPE_OPERATION.test(patch)) {
		return normalizeEnvelopedPatch(patch);
	}
	if (GIT_FILE_HEADER.test(patch)) return normalizeGitStylePatch(patch);
	if (UNIFIED_FILE_HEADER.test(patch)) {
		return normalizeUnifiedPatch(patch, fallbackPath);
	}
	if (HUNK_HEADER.test(patch)) return normalizeBareHunks(patch, fallbackPath);

	return [];
}

/** Aggregate totals across every operation in one tool call. */
export function summarizePatchFiles(files: NormalizedPatchFile[]): {
	files: number;
	additions: number;
	deletions: number;
} {
	const paths = new Set(files.map((file) => file.path));
	return {
		files: paths.size,
		additions: files.reduce((total, file) => total + file.additions, 0),
		deletions: files.reduce((total, file) => total + file.deletions, 0),
	};
}

/**
 * Normalizes a `git diff` payload for a single selected file into one unified
 * patch. Returns `null` when no renderable patch exists for that file.
 */
export function normalizeGitPatch(
	diffText: string,
	filePath: string,
): string | null {
	return normalizeGitDiffFile(diffText, filePath)?.patch ?? null;
}

/**
 * Resolves the single renderable operation for a selected Git file, keeping the
 * parsed {@link FileDiffMetadata} (and its stable cache key) so the full-pane
 * viewer does not reparse the patch.
 */
export function normalizeGitDiffFile(
	diffText: string,
	filePath: string,
): NormalizedPatchFile | null {
	const files = normalizeToolPatch(diffText, filePath).filter(
		(file) => file.renderable,
	);
	if (files.length === 0) return null;
	if (files.length === 1) return files[0];

	const target = stripSidePrefix(filePath);
	return files.find((file) => file.path === target) ?? files[0];
}

export { ENVELOPE_FILE as ENVELOPE_FILE_PATTERN };
