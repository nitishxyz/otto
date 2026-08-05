import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MiniAppViewerPanel } from '../packages/web-sdk/src/components/mini-apps/MiniAppViewerPanel';
import { ToolResultRenderer } from '../packages/web-sdk/src/components/messages/renderers';

const artifact = {
	kind: 'mini_app',
	schemaVersion: 1,
	appId: 'project-health',
	name: 'Project Health',
	description: 'Inspect the active project',
	runtime: 'otto-react',
	root: '.otto/apps/project-health',
	entry: 'src/main.tsx',
	contentHash: 'a'.repeat(64),
	revisionId: 'aaaaaaaaaaaa',
	availability: { global: false, project: true, requiresProject: true },
	permissions: ['project.read'],
	capabilities: ['project.status'],
	placements: ['apps'],
	previewUrl: 'http://localhost:4173/',
};

describe('Mini App UI', () => {
	test('renders a first-class app card with a preview action', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="mini_app"
				contentJson={{ result: { ok: true, artifact } }}
			/>,
		);

		expect(markup).toContain('Project Health');
		expect(markup).toContain('project-health');
		expect(markup).toContain('Open app');
		expect(markup).toContain('rev aaaaaaaaaaaa');
	});

	test('uses a sandboxed iframe without same-origin access', () => {
		const markup = renderToStaticMarkup(
			<MiniAppViewerPanel
				tab={{
					id: 'mini-app:project-health',
					type: 'mini-app',
					title: 'Project Health',
					appId: 'project-health',
					url: 'http://localhost:4173/',
					revisionId: 'aaaaaaaaaaaa',
					reloadKey: 0,
				}}
			/>,
		);

		expect(markup).toContain(
			'sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"',
		);
		expect(markup).not.toContain('allow-same-origin');
		expect(markup).toContain('Sandboxed local preview');
	});

	test('does not render untrusted preview paths as links', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="mini_app"
				contentJson={{
					result: {
						ok: true,
						artifact: {
							...artifact,
							previewUrl: undefined,
							previewPath: '//example.com/steal',
						},
					},
				}}
			/>,
		);

		expect(markup).not.toContain('Open app');
		expect(markup).not.toContain('example.com');
	});
});
