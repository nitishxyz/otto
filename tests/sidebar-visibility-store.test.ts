import { afterEach, describe, expect, test } from 'bun:test';
import { useRightRailStore } from '../packages/web-sdk/src/stores/rightRailStore';
import { useSidebarStore } from '../packages/web-sdk/src/stores/sidebarStore';

afterEach(() => {
	useSidebarStore.getState().setCollapsed(false);
	useRightRailStore.getState().setPinned(true);
});

describe('sidebar visibility stores', () => {
	test('shows the left sidebar and right rail by default', () => {
		expect(useSidebarStore.getInitialState().isCollapsed).toBe(false);
		expect(useRightRailStore.getInitialState().isPinned).toBe(true);
	});

	test('toggles the right rail without collapsing the left sidebar', () => {
		useSidebarStore.getState().setCollapsed(false);
		useRightRailStore.getState().setPinned(true);

		useRightRailStore.getState().togglePinned();

		expect(useRightRailStore.getState().isPinned).toBe(false);
		expect(useSidebarStore.getState().isCollapsed).toBe(false);
	});

	test('toggles the left sidebar without hiding the right rail', () => {
		useSidebarStore.getState().setCollapsed(false);
		useRightRailStore.getState().setPinned(true);

		useSidebarStore.getState().toggleCollapse();

		expect(useSidebarStore.getState().isCollapsed).toBe(true);
		expect(useRightRailStore.getState().isPinned).toBe(true);
	});
});
