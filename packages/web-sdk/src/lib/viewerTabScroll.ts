export interface ScrollRevealBounds {
	containerLeft: number;
	containerRight: number;
	targetLeft: number;
	targetRight: number;
	currentScrollLeft: number;
	padding?: number;
}

/**
 * Returns the minimal horizontal scrollLeft needed to reveal a target, or null
 * when the target is already fully visible inside the container.
 */
export function getScrollLeftToRevealTarget({
	containerLeft,
	containerRight,
	targetLeft,
	targetRight,
	currentScrollLeft,
	padding = 4,
}: ScrollRevealBounds): number | null {
	const visibleLeft = containerLeft + padding;
	const visibleRight = containerRight - padding;

	if (targetLeft >= visibleLeft && targetRight <= visibleRight) return null;

	const alignLeftDelta = targetLeft - visibleLeft;
	const alignRightDelta = targetRight - visibleRight;
	const delta =
		targetLeft < visibleLeft && targetRight > visibleRight
			? Math.abs(alignLeftDelta) <= Math.abs(alignRightDelta)
				? alignLeftDelta
				: alignRightDelta
			: targetLeft < visibleLeft
				? alignLeftDelta
				: alignRightDelta;

	return Math.max(0, currentScrollLeft + delta);
}
