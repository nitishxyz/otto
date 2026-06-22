export const LARGE_FILE_LIMITED_PREVIEW_CHARS = 200_000;
export const LARGE_FILE_NOTICE_CHARS = 500_000;
export const LARGE_FILE_TAIL_CHARS = 120_000;
export const LARGE_WRITE_FILE_TAB_PREVIEW_CHARS = 80_000;
export const LARGE_WRITE_FILE_TAB_PREVIEW_TAIL_CHARS = 32_000;
export const LARGE_PATCH_FILE_TAB_PREVIEW_CHARS = 80_000;
export const LARGE_PATCH_FILE_TAB_BASE_CHARS = 120_000;
export const LARGE_PATCH_FILE_TAB_PREVIEW_TAIL_CHARS = 32_000;

export function getLimitedFilePreview(
	content: string,
	activityView = false,
): {
	content: string;
	notice?: string;
} {
	if (activityView || content.length <= LARGE_FILE_LIMITED_PREVIEW_CHARS) {
		return { content };
	}
	const notice =
		content.length >= LARGE_FILE_NOTICE_CHARS
			? 'Very large file: showing the tail only to keep the viewer responsive.'
			: 'Large file: showing the tail only to keep the viewer responsive.';
	return {
		content: `… showing the latest ${LARGE_FILE_TAIL_CHARS.toLocaleString()} characters only …\n${content.slice(
			-LARGE_FILE_TAIL_CHARS,
		)}`,
		notice,
	};
}

export function getTailPreview(content: string, charLimit: number): string {
	if (content.length <= charLimit) return content;
	return `… showing the latest ${charLimit.toLocaleString()} characters only …\n${content.slice(
		-charLimit,
	)}`;
}

export function shouldUseLargePatchFallback({
	activityView,
	patchLength,
	baseContentLength,
}: {
	activityView: boolean;
	patchLength: number;
	baseContentLength: number;
}): boolean {
	return (
		!activityView &&
		(patchLength >= LARGE_PATCH_FILE_TAB_PREVIEW_CHARS ||
			baseContentLength >= LARGE_PATCH_FILE_TAB_BASE_CHARS)
	);
}

export function getLargePatchFallbackContent({
	activityView,
	patch,
	baseContent,
}: {
	activityView: boolean;
	patch: string | undefined;
	baseContent: string | undefined;
}): string | undefined {
	if (
		!shouldUseLargePatchFallback({
			activityView,
			patchLength: patch?.length ?? 0,
			baseContentLength: baseContent?.length ?? 0,
		})
	) {
		return undefined;
	}
	return getTailPreview(
		patch ?? 'Patch preview is too large to render.',
		LARGE_PATCH_FILE_TAB_PREVIEW_TAIL_CHARS,
	);
}

export function getLargeWriteFallbackContent({
	activityView,
	content,
}: {
	activityView: boolean;
	content: string | undefined;
}): string | undefined {
	if (
		activityView ||
		content === undefined ||
		content.length < LARGE_WRITE_FILE_TAB_PREVIEW_CHARS
	) {
		return undefined;
	}
	return getTailPreview(content, LARGE_WRITE_FILE_TAB_PREVIEW_TAIL_CHARS);
}
