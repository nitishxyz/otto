import { describe, expect, test } from 'bun:test';

const RESIZABLE_PANELS = [
	'packages/web-sdk/src/components/git/GitSidebar.tsx',
	'packages/web-sdk/src/components/session-files/SessionFilesSidebar.tsx',
	'packages/web-sdk/src/components/file-browser/FileBrowserSidebar.tsx',
	'packages/web-sdk/src/components/settings/SettingsSidebar.tsx',
	'packages/web-sdk/src/components/research/ResearchSidebar.tsx',
];

const FILL_PANELS = [
	'packages/web-sdk/src/components/mcp/MCPSidebar.tsx',
	'packages/web-sdk/src/components/skills/SkillsSidebar.tsx',
	'packages/web-sdk/src/components/tunnel/TunnelSidebar.tsx',
];

const LAYOUTS = [
	'apps/desktop/src/components/workspace/DesktopAppLayout.tsx',
	'apps/web/src/components/layout/AppLayout.tsx',
];

describe('right panel width behavior', () => {
	test('resizable panels fill their host container instead of pinning a pixel width', async () => {
		for (const path of RESIZABLE_PANELS) {
			const source = await Bun.file(path).text();

			// The host layout owns the panel width; the panel must stretch to it so
			// narrow/compact windows do not leave an empty gutter on the right.
			expect(source).toContain('style={{ minWidth: panelWidth }}');
			expect(source).not.toContain('style={{ width: panelWidth }}');
			expect(source).toContain(
				'className="w-full border-l border-sidebar-border sidebar-fade-in flex h-full relative"',
			);
		}
	});

	test('non-resizable panels keep filling the host container', async () => {
		for (const path of FILL_PANELS) {
			const source = await Bun.file(path).text();
			expect(source).toContain(
				'w-full min-w-80 border-l border-sidebar-border',
			);
		}
	});

	test('layouts size the right panel from the shared panel width store', async () => {
		for (const path of LAYOUTS) {
			const source = await Bun.file(path).text();
			expect(source).toContain('activeRightPanelWidth');
			expect(source).toContain('380px');
		}
	});
});
