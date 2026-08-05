import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildArtifactTool, getLazyToolDefinitions } from '@ottocode/sdk';

let projectRoot: string;

beforeEach(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-artifact-tool-'));
});

afterEach(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('artifact tool', () => {
	test('is discoverable as a loadable first-party tool', () => {
		expect(
			getLazyToolDefinitions().some(({ name }) => name === 'artifact'),
		).toBe(true);
		const { tool } = buildArtifactTool(projectRoot);
		expect(tool.description).toContain('studio: boxy Otto product UI');
		expect(tool.description).toContain('Never wrap Metric in Card');
		expect(tool.description).toContain('BarChart');
	});

	test('compiles an inline Artifact without writing project source', async () => {
		const { tool } = buildArtifactTool(projectRoot);
		const result = (await tool.execute?.({
			artifactId: 'release-health',
			title: 'Release Health',
			description: 'Readiness at a glance',
			source: `import { Artifact, Header, Metric, Grid } from '@otto/artifact';
+export default function App() { return <Artifact><Header title="Release Health" /><Grid><Metric label="Checks" value="8/8" trend="+2" /></Grid></Artifact>; }`.replace(
				/^\+/gm,
				'',
			),
		})) as Record<string, unknown>;
		const artifact = result.artifact as Record<string, unknown>;

		expect(result.ok).toBe(true);
		expect(artifact.kind).toBe('artifact');
		expect(artifact.runtime).toBe('otto-react-artifact');
		expect(artifact.previewPath).toMatch(
			/^\/v1\/artifacts\/release-health\/revisions\/[a-f0-9]{12}\/$/,
		);
		expect(artifact.libraries).toContain('@otto/artifact');
		expect(
			await Bun.file(
				join(
					projectRoot,
					'.otto',
					'cache',
					'artifacts',
					'release-health',
					String(artifact.revisionId),
					'index.html',
				),
			).exists(),
		).toBe(true);
	});
});
