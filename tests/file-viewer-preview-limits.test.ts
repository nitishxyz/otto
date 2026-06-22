import { describe, expect, test } from 'bun:test';
import {
	LARGE_FILE_LIMITED_PREVIEW_CHARS,
	LARGE_PATCH_FILE_TAB_BASE_CHARS,
	LARGE_PATCH_FILE_TAB_PREVIEW_CHARS,
	LARGE_WRITE_FILE_TAB_PREVIEW_CHARS,
	getLargePatchFallbackContent,
	getLargeWriteFallbackContent,
	getLimitedFilePreview,
	shouldUseLargePatchFallback,
} from '../packages/web-sdk/src/components/file-browser/fileViewerPreviewLimits';

describe('file viewer preview limits', () => {
	test('keeps full large file content for agent activity views', () => {
		const content = `${'a'.repeat(LARGE_FILE_LIMITED_PREVIEW_CHARS)}tail`;

		expect(getLimitedFilePreview(content, true)).toEqual({ content });
		expect(getLimitedFilePreview(content, false).content).not.toBe(content);
		expect(getLimitedFilePreview(content, false).notice).toContain(
			'Large file',
		);
	});

	test('does not use large patch fallback for agent activity views', () => {
		const patch = `${'diff --git a/large.ts b/large.ts\n'.repeat(
			LARGE_PATCH_FILE_TAB_PREVIEW_CHARS / 32,
		)}+tail`;
		const baseContent = 'x'.repeat(LARGE_PATCH_FILE_TAB_BASE_CHARS);

		expect(
			shouldUseLargePatchFallback({
				activityView: true,
				patchLength: patch.length,
				baseContentLength: baseContent.length,
			}),
		).toBe(false);
		expect(
			getLargePatchFallbackContent({
				activityView: true,
				patch,
				baseContent,
			}),
		).toBeUndefined();
		expect(
			getLargePatchFallbackContent({
				activityView: false,
				patch,
				baseContent,
			}),
		).toContain('+tail');
	});

	test('does not use large write fallback for agent activity views', () => {
		const content = `${'written\n'.repeat(
			LARGE_WRITE_FILE_TAB_PREVIEW_CHARS / 8,
		)}tail`;

		expect(
			getLargeWriteFallbackContent({ activityView: true, content }),
		).toBeUndefined();
		expect(
			getLargeWriteFallbackContent({ activityView: false, content }),
		).toContain('tail');
	});
});
