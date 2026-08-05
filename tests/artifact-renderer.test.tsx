import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	ArtifactStreamingPreview,
	extractStreamingArtifactField,
} from '../packages/web-sdk/src/components/messages/ArtifactStreamingPreview';
import { ToolResultRenderer } from '../packages/web-sdk/src/components/messages/renderers';

const artifact = {
	kind: 'artifact',
	schemaVersion: 1,
	artifactId: 'habit-momentum',
	title: 'Habit Momentum',
	description: 'An interactive weekly habit dashboard',
	runtime: 'otto-react-artifact',
	contentHash: 'a'.repeat(64),
	revisionId: 'aaaaaaaaaaaa',
	previewPath: '/v1/artifacts/habit-momentum/revisions/aaaaaaaaaaaa/',
	previewUrl: 'http://localhost:4173/v1/artifacts/habit-momentum/',
	libraries: ['@otto/artifact', 'react', 'motion', 'lucide-react'],
};

describe('Artifact renderer', () => {
	test('renders the compiled Artifact inline', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="artifact"
				contentJson={{ result: { ok: true, artifact } }}
			/>,
		);

		expect(markup).toContain('Habit Momentum');
		expect(markup).toContain('Otto Artifact · rev aaaaaaaaaaaa');
		expect(markup).toContain('React runtime');
		expect(markup).toContain('<iframe');
		expect(markup).toContain('sandbox="allow-scripts"');
		expect(markup).not.toContain('allow-same-origin');
	});

	test('rejects non-local explicit preview URLs', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="artifact"
				contentJson={{
					result: {
						ok: true,
						artifact: {
							...artifact,
							previewPath: '//example.com/steal',
							previewUrl: 'https://example.com/steal',
						},
					},
				}}
			/>,
		);

		expect(markup).not.toContain('<iframe');
		expect(markup).not.toContain('example.com');
		expect(markup).toContain('preview is unavailable');
	});

	test('keeps failed builds collapsed behind an errored tool header', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="artifact"
				contentJson={{ result: { ok: false, error: 'Bundle failed' } }}
			/>,
		);

		expect(markup).toContain('artifact');
		expect(markup).toContain('failed');
		expect(markup).not.toContain('Tool Error:');
		expect(markup).not.toContain('Bundle failed');
	});

	test('renders progressive metadata from partial streamed tool input', () => {
		const input =
			'{"artifactId":"release-health","title":"Release Readiness","description":"Live status","source":"import { Artifact } from \\"@otto/artifact\\";\\nexport default';
		const markup = renderToStaticMarkup(
			<ArtifactStreamingPreview streamedInput={input} />,
		);

		expect(extractStreamingArtifactField(input, 'title')).toBe(
			'Release Readiness',
		);
		expect(extractStreamingArtifactField(input, 'source')).toContain(
			'export default',
		);
		expect(markup).toContain('Release Readiness');
		expect(markup).toContain('Streaming React source');
	});
});
