const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'svg',
	'webp',
	'ico',
	'bmp',
	'avif',
]);

export const LARGE_DIFF_LIMITED_PREVIEW_CHARS = 200_000;
export const LARGE_DIFF_NOTICE_CHARS = 500_000;
export const LARGE_DIFF_TAIL_CHARS = 120_000;

export function isImageFile(filePath: string): boolean {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return IMAGE_EXTENSIONS.has(ext);
}

/** Returns just the filename portion of a path. */
export function getFileName(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1];
}

export interface LimitedPreview {
	content: string;
	notice?: string;
}

export function getLimitedPreview(content: string): LimitedPreview {
	if (content.length <= LARGE_DIFF_LIMITED_PREVIEW_CHARS) return { content };
	const notice =
		content.length >= LARGE_DIFF_NOTICE_CHARS
			? 'Very large diff/file: showing the tail only to keep the viewer responsive.'
			: 'Large diff/file: showing the tail only to keep the viewer responsive.';
	return {
		content: `… showing the latest ${LARGE_DIFF_TAIL_CHARS.toLocaleString()} characters only …\n${content.slice(
			-LARGE_DIFF_TAIL_CHARS,
		)}`,
		notice,
	};
}
