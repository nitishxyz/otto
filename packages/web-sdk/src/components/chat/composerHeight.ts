/** Height of a single composer row; also the resting height of an empty input. */
export const COMPOSER_BASE_HEIGHT = '2.5rem';

interface ComposerHeightInput {
	/** Current textarea value. */
	value: string;
	/** `scrollHeight` measured after resetting the inline height to `auto`. */
	scrollHeight: number;
}

/**
 * Resolves the autosized height for the chat composer textarea.
 *
 * An empty composer can never need more than the single base row, so a
 * measurement taken before the surrounding layout settled (narrow windows,
 * panels still animating, fonts not applied yet) is discarded instead of being
 * pinned to the element until the user types.
 */
export function resolveComposerHeight({
	value,
	scrollHeight,
}: ComposerHeightInput): string {
	if (!value) return COMPOSER_BASE_HEIGHT;
	if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) {
		return COMPOSER_BASE_HEIGHT;
	}
	return `${scrollHeight}px`;
}
