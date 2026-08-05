import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function rightPanelArea(source: string): string {
	const start = source.indexOf('const RightPanelArea');
	const end = source.indexOf('interface MobilePanelMenuProps', start);
	if (start < 0 || end < 0) throw new Error('RightPanelArea block not found');
	return source.slice(start, end);
}

describe('Apps right panel layout', () => {
	test('includes Apps state in the web panel width calculation', () => {
		const source = readFileSync(
			'apps/web/src/components/layout/AppLayout.tsx',
			'utf8',
		);
		const panel = rightPanelArea(source);

		expect(panel).toContain(
			'const appsExpanded = useAppsStore((s) => s.isExpanded);',
		);
		expect(panel).toMatch(/const anyRightPanelOpen =[\s\S]*?appsExpanded;/);
		expect(panel).toContain('<AppsSidebar />');
	});

	test('includes Apps state in the desktop panel width calculation', () => {
		const source = readFileSync(
			'apps/desktop/src/components/workspace/DesktopAppLayout.tsx',
			'utf8',
		);

		expect(source).toContain(
			'const appsExpanded = useAppsStore((s) => s.isExpanded);',
		);
		expect(source).toMatch(/const anyRightPanelOpen =[\s\S]*?appsExpanded;/);
		expect(source).toContain('<AppsSidebar />');
	});
});
