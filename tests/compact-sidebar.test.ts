import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createJSONStorage } from 'zustand/middleware';

const values = new Map<string, string>();
const memoryStorage = {
	get length() {
		return values.size;
	},
	clear: () => values.clear(),
	getItem: (key: string) => values.get(key) ?? null,
	key: (index: number) => [...values.keys()][index] ?? null,
	removeItem: (key: string) => values.delete(key),
	setItem: (key: string, value: string) => values.set(key, value),
};
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
// zustand's persist middleware resolves `window.localStorage` at store
// creation, so the shim has to exist before the store module is imported.
Object.defineProperty(globalThis, 'window', {
	configurable: true,
	value: { localStorage: memoryStorage },
});

const { useSidebarStore } = await import(
	'../packages/web-sdk/src/stores/sidebarStore'
);
const storage = createJSONStorage(() => memoryStorage);

function resetStore() {
	values.clear();
	useSidebarStore.persist.setOptions({ storage });
	useSidebarStore.setState({
		isCollapsed: false,
		isCompact: false,
		wideCollapsed: false,
	});
}

describe('compact sidebar behavior', () => {
	beforeEach(resetStore);

	afterAll(() => {
		if (originalWindow) {
			Object.defineProperty(globalThis, 'window', originalWindow);
		} else {
			Reflect.deleteProperty(globalThis, 'window');
		}
	});

	test('compact viewports start with the sidebar closed', () => {
		useSidebarStore.getState().setCompactViewport(true);
		expect(useSidebarStore.getState().isCollapsed).toBe(true);
		expect(useSidebarStore.getState().isCompact).toBe(true);
	});

	test('entering compact does not inherit the open docked default', () => {
		expect(useSidebarStore.getState().isCollapsed).toBe(false);
		useSidebarStore.getState().setCompactViewport(true);
		expect(useSidebarStore.getState().isCollapsed).toBe(true);
	});

	test('navigation closes the compact overlay', () => {
		useSidebarStore.getState().setCompactViewport(true);
		useSidebarStore.getState().setCollapsed(false);
		expect(useSidebarStore.getState().isCollapsed).toBe(false);

		useSidebarStore.getState().collapseForNavigation();
		expect(useSidebarStore.getState().isCollapsed).toBe(true);
	});

	test('navigation never collapses a docked wide sidebar', () => {
		useSidebarStore.getState().setCompactViewport(false);
		useSidebarStore.getState().setCollapsed(false);

		useSidebarStore.getState().collapseForNavigation();
		expect(useSidebarStore.getState().isCollapsed).toBe(false);
	});

	test('compact toggles do not overwrite the docked preference', () => {
		useSidebarStore.getState().setCollapsed(false);
		useSidebarStore.getState().setCompactViewport(true);
		// Opening/closing the overlay in a narrow window is transient.
		useSidebarStore.getState().toggleCollapse();
		useSidebarStore.getState().toggleCollapse();
		expect(useSidebarStore.getState().wideCollapsed).toBe(false);

		useSidebarStore.getState().setCompactViewport(false);
		expect(useSidebarStore.getState().isCollapsed).toBe(false);
	});

	test('a collapsed wide preference is restored when the window grows', () => {
		useSidebarStore.getState().setCollapsed(true);
		expect(useSidebarStore.getState().wideCollapsed).toBe(true);

		useSidebarStore.getState().setCompactViewport(true);
		useSidebarStore.getState().setCollapsed(false);
		useSidebarStore.getState().setCompactViewport(false);

		expect(useSidebarStore.getState().isCollapsed).toBe(true);
	});

	test('only the docked preference is persisted', async () => {
		useSidebarStore.getState().setCollapsed(true);
		await useSidebarStore.persist.rehydrate();
		const persisted = JSON.parse(values.get('sidebar-storage') ?? '{}');
		expect(persisted.state).toEqual({ wideCollapsed: true });
		expect(persisted.version).toBe(2);
	});

	test('legacy persisted state migrates into the docked preference', async () => {
		values.set(
			'sidebar-storage',
			JSON.stringify({ state: { isCollapsed: true }, version: 1 }),
		);
		await useSidebarStore.persist.rehydrate();
		expect(useSidebarStore.getState().wideCollapsed).toBe(true);
		expect(useSidebarStore.getState().isCollapsed).toBe(true);
	});
});

describe('desktop compact sidebar wiring', () => {
	test('the layout reports the compact viewport to the sidebar store', async () => {
		const source = await Bun.file(
			'apps/desktop/src/components/workspace/DesktopAppLayout.tsx',
		).text();
		expect(source).toContain(
			'useSidebarStore.getState().setCompactViewport(compactLayout)',
		);
		// Must land before paint so a narrow window never flashes the overlay.
		expect(source).toContain('useLayoutEffect(() => {');
	});

	test('session navigation closes the compact overlay', async () => {
		const source = await Bun.file(
			'apps/desktop/src/components/workspace/DesktopSessionsLayout.tsx',
		).text();
		expect(source).toContain(
			'useSidebarStore.getState().collapseForNavigation()',
		);
		for (const handler of [
			'const handleSelectSession',
			'const handleSelectLooperSession',
			'const handleSessionCreated',
			'const handleLooperSessionCreated',
			'const handleNewSession',
		]) {
			const start = source.indexOf(handler);
			expect(start).toBeGreaterThan(-1);
			expect(source.slice(start, start + 400)).toContain(
				'closeSidebarOverlay()',
			);
		}
	});

	test('only the compact overlay locks body scrolling', async () => {
		const source = await Bun.file(
			'apps/desktop/src/components/workspace/DesktopSidebar.tsx',
		).text();
		expect(source).toContain('if (isCompact && !isCollapsed) {');
	});

	test('the closed compact right panel does not leave its border visible', async () => {
		const source = await Bun.file(
			'apps/desktop/src/components/workspace/DesktopAppLayout.tsx',
		).text();
		const compactPanel = source.slice(
			source.indexOf("? 'absolute inset-y-0 right-12"),
			source.indexOf('style={rightPanelStyle}'),
		);
		expect(compactPanel).toContain('compactLayout && shouldRenderRightPanel');
		expect(compactPanel).toContain(
			"? 'border-l border-sidebar-border shadow-2xl'",
		);
	});
});
