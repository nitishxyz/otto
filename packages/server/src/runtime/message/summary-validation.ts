export const MIN_SUMMARY_CHARS = 50;

export type SummaryValidationResult =
	| { ok: true }
	| { ok: false; reason: string };

/**
 * Decides whether model output may be installed as a compaction checkpoint or
 * handoff summary. Truncated (`length`), failed (`error`), empty, or
 * undersized output is rejected so callers keep the prior state.
 */
export function validateSummary(args: {
	text: string | null | undefined;
	finishReason?: string | null;
	minChars?: number;
}): SummaryValidationResult {
	const finishReason = args.finishReason ?? undefined;
	if (finishReason === 'length') {
		return { ok: false, reason: 'Summary exceeded the output limit' };
	}
	if (finishReason === 'error') {
		return { ok: false, reason: 'Summary generation failed' };
	}
	if (finishReason === 'content-filter') {
		return { ok: false, reason: 'Summary was blocked by a content filter' };
	}
	const text = args.text?.trim() ?? '';
	if (!text) return { ok: false, reason: 'Summary is empty' };
	const minChars = args.minChars ?? MIN_SUMMARY_CHARS;
	if (text.length < minChars) {
		return {
			ok: false,
			reason: `Summary is too short (${text.length} < ${minChars} characters)`,
		};
	}
	return { ok: true };
}
