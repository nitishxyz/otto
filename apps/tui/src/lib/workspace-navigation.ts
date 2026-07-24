import type { ActivityFocus } from '../components/activity/types.ts';

export interface WorkspacePaneState {
	focus: ActivityFocus;
	showDetail: boolean;
	showActivity: boolean;
}

/** Returns the next visible pane in the requested spatial direction. */
export function moveWorkspaceFocus(
	state: WorkspacePaneState,
	direction: 'left' | 'right',
): ActivityFocus {
	const panes: ActivityFocus[] = ['chat'];
	if (state.showDetail) panes.push('detail');
	if (state.showActivity) panes.push('activity');
	const currentIndex = panes.indexOf(state.focus);
	if (currentIndex === -1) return panes[0];
	const offset = direction === 'left' ? -1 : 1;
	return panes[Math.max(0, Math.min(panes.length - 1, currentIndex + offset))];
}

/** Returns the adjacent activity tab, wrapping at either edge. */
export function moveActivityTab<T>(
	tabs: readonly T[],
	current: T,
	direction: 'left' | 'right',
): T {
	const currentIndex = Math.max(0, tabs.indexOf(current));
	const offset = direction === 'left' ? -1 : 1;
	return tabs[(currentIndex + offset + tabs.length) % tabs.length];
}
