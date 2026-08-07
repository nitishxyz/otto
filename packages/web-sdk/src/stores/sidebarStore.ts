import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
	/** Effective collapsed state for the current viewport. */
	isCollapsed: boolean;
	/**
	 * True while the layout renders the sidebar as overlay navigation instead
	 * of a docked column (narrow windows). Layouts opt in via
	 * `setCompactViewport`; nothing changes for layouts that never call it.
	 */
	isCompact: boolean;
	/** Persisted docked preference. Only ever written from wide viewports. */
	wideCollapsed: boolean;
	toggleCollapse: () => void;
	setCollapsed: (collapsed: boolean) => void;
	/** Switches between docked (wide) and overlay (compact) behavior. */
	setCompactViewport: (compact: boolean) => void;
	/** Closes the overlay after navigating; no-op on wide viewports. */
	collapseForNavigation: () => void;
}

interface PersistedSidebarState {
	wideCollapsed: boolean;
}

export const useSidebarStore = create<SidebarState>()(
	persist(
		(set, get) => ({
			isCollapsed: false,
			isCompact: false,
			wideCollapsed: false,
			toggleCollapse: () => {
				get().setCollapsed(!get().isCollapsed);
			},
			setCollapsed: (collapsed) => {
				const { isCompact } = get();
				set(
					isCompact
						? { isCollapsed: collapsed }
						: { isCollapsed: collapsed, wideCollapsed: collapsed },
				);
			},
			setCompactViewport: (compact) => {
				const state = get();
				if (state.isCompact === compact) return;
				// A compact window covers the whole workspace when the sidebar is
				// open, so it always starts closed; widening restores the docked
				// preference the user set at wide sizes.
				set({
					isCompact: compact,
					isCollapsed: compact ? true : state.wideCollapsed,
				});
			},
			collapseForNavigation: () => {
				const state = get();
				if (!state.isCompact || state.isCollapsed) return;
				set({ isCollapsed: true });
			},
		}),
		{
			name: 'sidebar-storage',
			version: 2,
			partialize: (state): PersistedSidebarState => ({
				wideCollapsed: state.wideCollapsed,
			}),
			migrate: (persisted): PersistedSidebarState => {
				const legacy = persisted as Partial<SidebarState> | null;
				return {
					wideCollapsed: legacy?.wideCollapsed ?? legacy?.isCollapsed ?? false,
				};
			},
			merge: (persisted, current): SidebarState => {
				const next = {
					...current,
					...(persisted as Partial<SidebarState> | undefined),
				};
				return {
					...next,
					isCollapsed: next.isCompact ? true : next.wideCollapsed,
				};
			},
		},
	),
);
