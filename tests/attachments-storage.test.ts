import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { loadConfig } from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';
import { storeAttachmentBytes } from '../packages/server/src/routes/attachments.ts';
import { buildCopyAttachmentTool } from '../packages/sdk/src/core/src/tools/builtin/fs/copy-attachment.ts';

const appIconUrl = new URL(
	'../apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_512x512@2x.png',
	import.meta.url,
);

type TestImagePipeline = {
	resize(width: number, height: number): TestImagePipeline;
	png(): TestImagePipeline;
	bytes(): Promise<Uint8Array>;
};

type TestImageConstructor = new (input: Uint8Array) => TestImagePipeline;

async function withProject(
	prefix: string,
	fn: (projectRoot: string, ottoHome: string) => Promise<void>,
) {
	const projectRoot = await mkdtemp(join(tmpdir(), prefix));
	const previousOttoHome = process.env.OTTO_HOME;
	const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	const ottoHome = join(projectRoot, 'otto-home');
	process.env.OTTO_HOME = ottoHome;
	process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
	try {
		await fn(projectRoot, ottoHome);
	} finally {
		if (previousOttoHome === undefined) {
			delete process.env.OTTO_HOME;
		} else {
			process.env.OTTO_HOME = previousOttoHome;
		}
		if (previousXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		}
		await rm(projectRoot, { recursive: true, force: true });
	}
}

describe('attachment project state storage', () => {
	it('does not mutate the configured project registry', async () => {
		const configuredHome = await mkdtemp(
			join(tmpdir(), 'otto-configured-store-'),
		);
		const configuredOttoDir = join(configuredHome, 'otto');
		const registryPath = join(configuredOttoDir, 'projects.json');
		const sentinel = '{"version":1,"projects":[]}\n';
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		try {
			await mkdir(configuredOttoDir, { recursive: true });
			await writeFile(registryPath, sentinel);
			process.env.XDG_CONFIG_HOME = configuredHome;

			await withProject('otto-attachments-isolation-', async (projectRoot) => {
				const metadata = await storeAttachmentBytes({
					projectRoot,
					bytes: Buffer.from('isolated'),
					filename: 'isolated.txt',
					mimeType: 'text/plain',
				});
				const response = await createEmbeddedApp().request(
					`http://localhost/v1/attachments/${metadata.id}?project=${encodeURIComponent(projectRoot)}`,
				);
				expect(response.status).toBe(200);
			});

			expect(await readFile(registryPath, 'utf8')).toBe(sentinel);
		} finally {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			await rm(configuredHome, { recursive: true, force: true });
		}
	});

	it('stores new attachments under project state with project-state metadata', async () => {
		await withProject('otto-attachments-state-', async (projectRoot) => {
			const metadata = await storeAttachmentBytes({
				projectRoot,
				bytes: Buffer.from('hello attachment'),
				filename: 'hello.txt',
				mimeType: 'text/plain',
			});
			const cfg = await loadConfig(projectRoot);

			expect(metadata.storageRoot).toBe('project-state');
			expect(metadata.relativePath).toBe(
				join('attachments', metadata.id, 'original.txt'),
			);
			expect(metadata.originalPath).toBe(metadata.relativePath);
			expect(
				await readFile(
					join(cfg.paths.attachmentsDir, metadata.id, 'original.txt'),
					'utf8',
				),
			).toBe('hello attachment');
			expect(
				await Bun.file(
					join(
						projectRoot,
						'.otto',
						'attachments',
						metadata.id,
						'original.txt',
					),
				).exists(),
			).toBe(false);
		});
	});

	it('stores only the compressed representation of large raster images', async () => {
		await withProject('otto-attachments-image-', async (projectRoot) => {
			const icon = await readFile(appIconUrl);
			const ImageConstructor = (
				Bun as typeof Bun & { Image?: TestImageConstructor }
			).Image;
			if (!ImageConstructor)
				throw new Error('Bun.Image is required for this test');
			const input = Buffer.from(
				await new ImageConstructor(icon).resize(2048, 2048).png().bytes(),
			);
			const metadata = await storeAttachmentBytes({
				projectRoot,
				bytes: input,
				filename: 'icon.png',
				mimeType: 'image/png',
			});
			const cfg = await loadConfig(projectRoot);
			const storedPath = join(
				cfg.paths.projectStateDir,
				metadata.relativePath as string,
			);
			const stored = await readFile(storedPath);

			expect(metadata.mimeType).toBe('image/jpeg');
			expect(metadata.relativePath).toBe(
				join('attachments', metadata.id, 'original.jpg'),
			);
			expect(metadata.size).toBe(stored.byteLength);
			expect(stored.byteLength).toBeLessThan(input.byteLength);
			expect(Buffer.compare(stored, input)).not.toBe(0);
			expect(
				await Bun.file(
					join(cfg.paths.attachmentsDir, metadata.id, 'original.png'),
				).exists(),
			).toBe(false);
		});
	});

	it('reads state-stored attachment bytes from the server route', async () => {
		await withProject('otto-attachments-route-state-', async (projectRoot) => {
			const metadata = await storeAttachmentBytes({
				projectRoot,
				bytes: Buffer.from('state route bytes'),
				filename: 'Screenshot 2026-07-11 at 4.10.06 AM.txt',
				mimeType: 'text/plain',
			});
			const app = createEmbeddedApp();

			const response = await app.request(
				`http://localhost/v1/attachments/${metadata.id}?project=${encodeURIComponent(projectRoot)}`,
			);

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Disposition')).toContain(
				"filename*=UTF-8''Screenshot%202026-07-11%20at%204.10.06%E2%80%AFAM.txt",
			);
			expect(await response.text()).toBe('state route bytes');
		});
	});

	it('copies state-stored attachments with copy_attachment_to_project', async () => {
		await withProject('otto-copy-attachments-state-', async (projectRoot) => {
			const metadata = await storeAttachmentBytes({
				projectRoot,
				bytes: Buffer.from('copy me from state'),
				filename: 'state.txt',
				mimeType: 'text/plain',
			});
			const copyTool = buildCopyAttachmentTool(projectRoot);

			const result = await copyTool.tool.execute({
				attachmentId: metadata.id,
				targetPath: 'copied/state.txt',
			});

			expect(result).toHaveProperty('ok', true);
			expect(
				await readFile(join(projectRoot, 'copied', 'state.txt'), 'utf8'),
			).toBe('copy me from state');
		});
	});
});
