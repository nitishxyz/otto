import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	compileReactArtifact,
	readArtifactBuildDocument,
	resolveArtifactBuildAsset,
} from '../packages/sdk/src/core/src/artifacts/compiler';
import {
	ARTIFACT_AUTHORING_GUIDE,
	ARTIFACT_BASE_STYLES,
	ARTIFACT_BOXY_STYLES,
	ARTIFACT_RUNTIME_SOURCE,
} from '../packages/sdk/src/core/src/artifacts/runtime';

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'otto-artifact-'));
	temporaryRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('Otto Artifact runtime', () => {
	test('ships opinionated themes, components, and composition guidance', () => {
		for (const theme of ['studio', 'aurora', 'paper', 'terminal']) {
			expect(ARTIFACT_BASE_STYLES).toContain(`data-theme=${theme}`);
		}
		for (const component of ['Split', 'Callout', 'ListItem', 'BarChart']) {
			expect(ARTIFACT_RUNTIME_SOURCE).toContain(`export function ${component}`);
		}
		expect(ARTIFACT_AUTHORING_GUIDE).toContain('Never wrap Metric in Card');
		expect(ARTIFACT_AUTHORING_GUIDE).toContain(
			'<Artifact theme="studio" accent="blue" density="compact">',
		);
		expect(ARTIFACT_BOXY_STYLES).toContain('--otto-radius:3px');
		expect(ARTIFACT_BOXY_STYLES).toContain(
			'box-shadow:5px 5px 0 var(--otto-shadow-color)',
		);
	});

	test('compiles TSX with Otto primitives and curated libraries', async () => {
		const projectRoot = await temporaryProject();
		const build = await compileReactArtifact(projectRoot, {
			artifactId: 'weekly-habits',
			title: 'Weekly Habits',
			description: 'A conversational habit dashboard',
			source: `
+import { useState } from 'react';
+import { motion } from 'motion/react';
+import { Check } from 'lucide-react';
+import { Artifact, Header, Grid, Metric, Card, Button, Progress } from '@otto/artifact';
+
+export default function HabitArtifact() {
+  const [done, setDone] = useState(1);
+  return <Artifact theme="aurora" accent="violet" density="compact">
+    <Header eyebrow="This week" title="Habit momentum" description="Small actions, visible progress." />
+    <Grid columns={3}><Metric label="Completed" value={done} detail="of 3 today" /></Grid>
+    <Card><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Progress value={(done / 3) * 100} label="Today" /><Button onClick={() => setDone(3)}><Check size={15} />Complete all</Button></motion.div></Card>
+  </Artifact>;
+}`.replace(/^\+/gm, ''),
		});

		expect(build.runtime).toBe('otto-react-artifact');
		expect(build.previewPath).toBe(
			`/v1/artifacts/weekly-habits/revisions/${build.revisionId}/`,
		);
		expect(build.libraries).toContain('@otto/artifact');
		expect(await readArtifactBuildDocument(build)).toContain('Weekly Habits');
		const appSource = await readFile(
			await resolveArtifactBuildAsset(
				projectRoot,
				build.artifactId,
				build.revisionId,
				'app.js',
			),
			'utf8',
		);
		expect(appSource).toContain('Habit momentum');
		expect(appSource).toContain('./otto-runtime/lucide-react.js');
		expect(appSource).not.toContain('from"lucide-react"');
		expect(
			await resolveArtifactBuildAsset(
				projectRoot,
				build.artifactId,
				build.revisionId,
				'otto-runtime/react.js',
			),
		).toEndWith('otto-runtime/react.js');
		const styles = await readFile(
			await resolveArtifactBuildAsset(
				projectRoot,
				build.artifactId,
				build.revisionId,
				'app.css',
			),
			'utf8',
		);
		expect(styles).toContain('[data-theme=aurora]');
		expect(styles).toContain('.otto-list-item');
	});

	test('compiles curated packages from a standalone Bun executable', async () => {
		const projectRoot = await temporaryProject();
		const entryPath = join(projectRoot, 'compiled-repro.ts');
		const executablePath = join(
			projectRoot,
			process.platform === 'win32' ? 'compiled-repro.exe' : 'compiled-repro',
		);
		const compilerPath = join(
			import.meta.dir,
			'../packages/sdk/src/core/src/artifacts/compiler.ts',
		);
		await writeFile(
			entryPath,
			`import { compileReactArtifact } from ${JSON.stringify(compilerPath)};
await compileReactArtifact(${JSON.stringify(projectRoot)}, {
	artifactId: 'compiled-runtime',
	title: 'Compiled Runtime',
	source: "import { Check } from 'lucide-react'; import { Artifact } from '@otto/artifact'; export default function App() { return <Artifact><Check />Compiled</Artifact>; }",
});
console.log('compiled-runtime-ok');
`.replace(/^\+/gm, ''),
		);

		const compiled = Bun.spawnSync(
			[
				process.execPath,
				'build',
				'--compile',
				entryPath,
				'--outfile',
				executablePath,
			],
			{ cwd: projectRoot },
		);
		expect(compiled.exitCode).toBe(0);
		const executed = Bun.spawnSync([executablePath], { cwd: projectRoot });
		expect(executed.exitCode).toBe(0);
		expect(executed.stdout.toString()).toContain('compiled-runtime-ok');
	});

	test('rejects packages outside the curated runtime', async () => {
		const projectRoot = await temporaryProject();
		await expect(
			compileReactArtifact(projectRoot, {
				artifactId: 'unsafe-artifact',
				title: 'Unsafe',
				source:
					"import lodash from 'lodash'; export default function App() { return <div>{String(lodash)}</div>; }",
			}),
		).rejects.toThrow('not available in the curated Artifact runtime');
	});

	test('returns actionable syntax errors before bundling', async () => {
		const projectRoot = await temporaryProject();
		await expect(
			compileReactArtifact(projectRoot, {
				artifactId: 'broken-artifact',
				title: 'Broken',
				source:
					'export default function App() { return <div>Broken</section>; }',
			}),
		).rejects.toThrow('Artifact source is not valid TSX');
	});

	test('reuses immutable revisions for identical source', async () => {
		const projectRoot = await temporaryProject();
		const input = {
			artifactId: 'stable-artifact',
			title: 'Stable',
			source: 'export default function App() { return <div>Stable</div>; }',
		};
		const first = await compileReactArtifact(projectRoot, input);
		const second = await compileReactArtifact(projectRoot, input);

		expect(first.cached).toBe(false);
		expect(second.cached).toBe(true);
		expect(second.revisionId).toBe(first.revisionId);
	});
});
