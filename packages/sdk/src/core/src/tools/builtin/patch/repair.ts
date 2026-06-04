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
	patch = appendMissingEndMarker(patch);
	return patch;
}

function extractPatchFromWrappedJson(patch: string): string {
	if (patch.includes(PATCH_BEGIN_MARKER)) return patch;

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
	if (!trimmed.includes(PATCH_BEGIN_MARKER)) return patch;
	if (trimmed.includes(PATCH_END_MARKER)) return patch;

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
