import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMiniAppTool } from '@ottocode/sdk';

let projectRoot: string;

async function createMiniApp(
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const root = join(projectRoot, '.otto', 'apps', 'project-health');
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(
		join(root, 'app.json'),
		JSON.stringify(
			{
				$schema: 'otto://schemas/mini-app/v1',
				schemaVersion: 1,
				id: 'project-health',
				name: 'Project Health',
				description: 'Inspect the active project',
				runtime: 'otto-react',
				entry: 'src/main.tsx',
				availability: {
					global: false,
					project: true,
					requiresProject: true,
				},
				permissions: ['project.read'],
				capabilities: ['project.status'],
				placements: ['apps', 'project'],
				...overrides,
			},
			null,
			2,
		),
	);
	await writeFile(
		join(root, 'src', 'main.tsx'),
		'import { motion } from "motion/react";\nexport default function App() { return <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Healthy</motion.main>; }\n',
	);
	return root;
}

beforeEach(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-mini-app-'));
});

afterEach(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('mini_app tool', () => {
	test('validates and presents an application package', async () => {
		await createMiniApp();
		const { tool } = buildMiniAppTool(projectRoot);
		const result = (await tool.execute?.({
			action: 'present',
			root: '.otto/apps/project-health',
			previewUrl: 'http://localhost:4173/',
		})) as Record<string, unknown>;
		const artifact = result.artifact as Record<string, unknown>;

		expect(result.ok).toBe(true);
		expect(artifact.kind).toBe('mini_app');
		expect(artifact.appId).toBe('project-health');
		expect(artifact.root).toBe('.otto/apps/project-health');
		expect(artifact.entry).toBe('src/main.tsx');
		expect(artifact.previewUrl).toBe('http://localhost:4173/');
		expect(artifact.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(artifact.revisionId).toMatch(/^[a-f0-9]{12}$/);
	});

	test('changes the revision when source changes', async () => {
		const root = await createMiniApp();
		const { tool } = buildMiniAppTool(projectRoot);
		const first = (await tool.execute?.({
			action: 'present',
			root: '.otto/apps/project-health',
		})) as { artifact: { revisionId: string } };

		await writeFile(
			join(root, 'src', 'main.tsx'),
			'export default function App() { return <main>Updated</main>; }\n',
		);
		const second = (await tool.execute?.({
			action: 'present',
			root: '.otto/apps/project-health',
		})) as { artifact: { revisionId: string } };

		expect(second.artifact.revisionId).not.toBe(first.artifact.revisionId);
	});

	test('builds React and Motion with the curated embedded runtime', async () => {
		await createMiniApp();
		const { tool } = buildMiniAppTool(projectRoot);
		const result = (await tool.execute?.({
			action: 'build',
			root: '.otto/apps/project-health',
		})) as Record<string, unknown>;
		const artifact = result.artifact as Record<string, unknown>;

		expect(result.ok).toBe(true);
		expect(artifact.previewPath).toMatch(
			/^\/v1\/mini-apps\/project-health\/revisions\/[a-f0-9]{12}\/$/,
		);
		expect(
			await Bun.file(
				join(
					projectRoot,
					'.otto',
					'cache',
					'mini-apps',
					'project-health',
					String(artifact.revisionId),
					'index.html',
				),
			).exists(),
		).toBe(true);
	});

	test('rejects package imports outside the curated runtime', async () => {
		const root = await createMiniApp();
		await writeFile(
			join(root, 'src', 'main.tsx'),
			'import leftPad from "left-pad"; export default function App() { return <main>{leftPad("x", 2)}</main>; }\n',
		);
		const { tool } = buildMiniAppTool(projectRoot);
		const result = (await tool.execute?.({
			action: 'build',
			root: '.otto/apps/project-health',
		})) as Record<string, unknown>;

		expect(result.ok).toBe(false);
		expect(result.error).toContain('left-pad');
		expect(result.error).toContain('curated Mini App runtime');
	});

	test('rejects packages without a valid app manifest', async () => {
		const root = join(projectRoot, 'raw-page');
		await mkdir(root, { recursive: true });
		await writeFile(join(root, 'index.html'), '<h1>Not an app</h1>');
		const { tool } = buildMiniAppTool(projectRoot);
		const result = (await tool.execute?.({
			action: 'present',
			root: 'raw-page',
		})) as Record<string, unknown>;

		expect(result.ok).toBe(false);
		expect(result.error).toContain('app.json');
	});

	test('rejects non-local preview URLs', async () => {
		await createMiniApp();
		const { tool } = buildMiniAppTool(projectRoot);
		const result = (await tool.execute?.({
			action: 'present',
			root: '.otto/apps/project-health',
			previewUrl: 'https://example.com/app',
		})) as Record<string, unknown>;

		expect(result.ok).toBe(false);
		expect(result.error).toContain('localhost');
	});

	test('rejects app roots that resolve outside the project', async () => {
		const outsideRoot = await mkdtemp(join(tmpdir(), 'otto-mini-app-outside-'));
		try {
			await mkdir(join(outsideRoot, 'src'), { recursive: true });
			await writeFile(
				join(outsideRoot, 'app.json'),
				JSON.stringify({
					schemaVersion: 1,
					id: 'outside-app',
					name: 'Outside App',
					runtime: 'otto-react',
					entry: 'src/main.tsx',
				}),
			);
			await writeFile(join(outsideRoot, 'src', 'main.tsx'), 'export {};\n');
			await symlink(outsideRoot, join(projectRoot, 'linked-app'));
			const { tool } = buildMiniAppTool(projectRoot);
			const result = (await tool.execute?.({
				action: 'present',
				root: 'linked-app',
			})) as Record<string, unknown>;

			expect(result.ok).toBe(false);
			expect(result.error).toContain('outside the project');
		} finally {
			await rm(outsideRoot, { recursive: true, force: true });
		}
	});
});
