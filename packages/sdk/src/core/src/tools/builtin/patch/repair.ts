import {
	PATCH_ADD_PREFIX,
	PATCH_BEGIN_MARKER,
	PATCH_DELETE_LINES_PREFIX,
	PATCH_DELETE_PREFIX,
	PATCH_END_MARKER,
	PATCH_INSERT_AFTER_PREFIX,
	PATCH_INSERT_BEFORE_PREFIX,
	PATCH_REPLACE_LINES_PREFIX,
	PATCH_REPLACE_PREFIX,
	PATCH_UPDATE_PREFIX,
} from './constants.ts';

export function repairPatchContent(patch: string): string {
	patch = extractPatchFromWrappedJson(patch);
	patch = extractEnvelopedPatchFromText(patch);
	patch = stripTrailingMarkdownFenceBeforeMissingEndMarker(patch);
	patch = appendMissingEndMarker(patch);
	patch = trimAfterEndMarker(patch);
	return patch;
}

/**
 * Find a marker occurrence anchored at the start of a line. Markers embedded
 * mid-line (for example inside added file content) must not terminate parsing.
 */
function findMarkerLineIndex(patch: string, marker: string): number {
	if (patch.startsWith(marker)) return 0;
	const idx = patch.indexOf(`\n${marker}`);
	return idx === -1 ? -1 : idx + 1;
}

function looksLikeUnifiedPatch(patch: string): boolean {
	const trimmed = patch.trimStart();
	return (
		trimmed.startsWith('diff --git ') ||
		trimmed.startsWith('--- ') ||
		trimmed.startsWith('Index: ')
	);
}

function extractEnvelopedPatchFromText(patch: string): string {
	const beginIndex = findMarkerLineIndex(patch, PATCH_BEGIN_MARKER);
	if (beginIndex === -1) return patch;
	if (beginIndex === patch.search(/\S/)) return patch;
	if (looksLikeUnifiedPatch(patch)) return patch;
	return patch.slice(beginIndex);
}

function extractPatchFromWrappedJson(patch: string): string {
	if (findMarkerLineIndex(patch, PATCH_BEGIN_MARKER) !== -1) return patch;

	const trimmed = patch.trim();
	if (!trimmed.startsWith('{')) return patch;

	try {
		const parsed = JSON.parse(trimmed);
		if (typeof parsed === 'object' && parsed !== null) {
			if (typeof parsed.patch === 'string') return parsed.patch;
			if (
				typeof parsed.args === 'object' &&
				parsed.args !== null &&
				typeof parsed.args.patch === 'string'
			) {
				return parsed.args.patch;
			}
		}
	} catch {}

	return patch;
}

function appendMissingEndMarker(patch: string): string {
	const trimmed = patch.trimEnd();
	if (findMarkerLineIndex(trimmed, PATCH_BEGIN_MARKER) === -1) return patch;
	if (findMarkerLineIndex(trimmed, PATCH_END_MARKER) !== -1) return patch;

	const hasContent =
		trimmed.includes(PATCH_UPDATE_PREFIX) ||
		trimmed.includes(PATCH_ADD_PREFIX) ||
		trimmed.includes(PATCH_DELETE_PREFIX) ||
		trimmed.includes(PATCH_REPLACE_PREFIX) ||
		trimmed.includes(PATCH_DELETE_LINES_PREFIX) ||
		trimmed.includes(PATCH_REPLACE_LINES_PREFIX) ||
		trimmed.includes(PATCH_INSERT_BEFORE_PREFIX) ||
		trimmed.includes(PATCH_INSERT_AFTER_PREFIX);

	if (hasContent || trimmed.trim() === PATCH_BEGIN_MARKER) {
		return `${trimmed}\n${PATCH_END_MARKER}`;
	}

	return patch;
}

function stripTrailingMarkdownFenceBeforeMissingEndMarker(
	patch: string,
): string {
	const trimmed = patch.trimEnd();
	if (!trimmed.trimStart().startsWith(PATCH_BEGIN_MARKER)) return patch;
	if (findMarkerLineIndex(trimmed, PATCH_END_MARKER) !== -1) return patch;
	const lines = trimmed.split('\n');
	const last = lines.at(-1)?.trim();
	if (last !== '```') return patch;
	return lines.slice(0, -1).join('\n');
}

function trimAfterEndMarker(patch: string): string {
	if (!patch.trimStart().startsWith(PATCH_BEGIN_MARKER)) return patch;
	const endIndex = findMarkerLineIndex(patch, PATCH_END_MARKER);
	if (endIndex === -1) return patch;
	const endOfMarker = endIndex + PATCH_END_MARKER.length;
	const suffix = patch.slice(endOfMarker);
	if (suffix.trim().length === 0) return patch;
	return patch.slice(0, endOfMarker);
}
