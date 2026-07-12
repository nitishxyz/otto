import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('desktop project viewer lifecycle', () => {
	test('closes viewer tabs before leaving the current project', async () => {
		const app = await readFile('src/App.tsx', 'utf8');
		const handleBack = app.slice(
			app.indexOf('const handleBack = async () => {'),
			app.indexOf('const handleStartDaemon = async () => {'),
		);

		expect(app).toContain(
			"import { useViewerTabsStore } from '@ottocode/web-sdk/stores';",
		);
		expect(handleBack).toContain(
			'useViewerTabsStore.getState().closeAllTabs();',
		);
		expect(handleBack.indexOf('closeAllTabs()')).toBeLessThan(
			handleBack.indexOf("router.navigate({ to: '/projects' })"),
		);
	});
});
