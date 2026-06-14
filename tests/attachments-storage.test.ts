import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { loadConfig } from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';
import { storeAttachmentBytes } from '../packages/server/src/routes/attachments.ts';
import { buildCopyAttachmentTool } from '../packages/sdk/src/core/src/tools/builtin/fs/copy-attachment.ts';

async function withProject(
	prefix: string,
	fn: (projectRoot: string, ottoHome: string) => Promise<void>,
) {
	const projectRoot = await mkdtemp(join(tmpdir(), prefix));
	const previousOttoHome = process.env.OTTO_HOME;
	const ottoHome = join(projectRoot, 'otto-home');
	process.env.OTTO_HOME = ottoHome;
	try {
		await fn(projectRoot, ottoHome);
	} finally {
		if (previousOttoHome === undefined) {
			delete process.env.OTTO_HOME;
		} else {
			process.env.OTTO_HOME = previousOttoHome;
		}
		await rm(projectRoot, { recursive: true, force: true });
	}
}

describe('attachment project state storage', () => {
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

	it('reads state-stored attachment bytes from the server route', async () => {
		await withProject('otto-attachments-route-state-', async (projectRoot) => {
			const metadata = await storeAttachmentBytes({
				projectRoot,
				bytes: Buffer.from('state route bytes'),
				filename: 'route.txt',
				mimeType: 'text/plain',
			});
			const app = createEmbeddedApp();

			const response = await app.request(
				`http://localhost/v1/attachments/${metadata.id}?project=${encodeURIComponent(projectRoot)}`,
			);

			expect(response.status).toBe(200);
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
