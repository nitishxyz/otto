/**
 * Shared chrome for bars stacked directly above the chat input (sub-agents,
 * goal, todos, approvals, …).
 *
 * Contract: every stackable bar renders an outer wrapper that is a direct
 * sibling of the other bars and carries `INPUT_BAR_GROUP_CLASS` plus the
 * `INPUT_BAR_WRAPPER_PROPS`-style data attributes (`data-input-bar` and
 * `data-active="true" | "false"`). The inner card then appends
 * `INPUT_BAR_ATTACHED_CARD_CLASS` to its own border/background classes.
 *
 * By default the card visually connects to the chat input (open bottom edge,
 * top-only rounding, tucked under the input). When another active bar sits
 * below it in the stack, the `group-has` sibling selector switches the card
 * to a detached floating look — full rounded corners, restored bottom border,
 * and spacing — so only the bottom-most active bar merges with the input.
 */
export const INPUT_BAR_GROUP_CLASS = 'group/inputbar';

const FLOAT_WHEN_BAR_BELOW =
	'group-has-[~[data-input-bar][data-active=true]]/inputbar:rounded-xl ' +
	'group-has-[~[data-input-bar][data-active=true]]/inputbar:border-b ' +
	'group-has-[~[data-input-bar][data-active=true]]/inputbar:mb-1 ' +
	'group-has-[~[data-input-bar][data-active=true]]/inputbar:pb-0';

export const INPUT_BAR_ATTACHED_CARD_CLASS = `rounded-t-xl border-b-0 -mb-1 pb-2 ${FLOAT_WHEN_BAR_BELOW}`;

/** Builds the wrapper data attributes marking a stackable input bar. */
export function inputBarWrapperProps(isActive: boolean) {
	return {
		'data-input-bar': true,
		'data-active': isActive ? 'true' : 'false',
	} as const;
}
