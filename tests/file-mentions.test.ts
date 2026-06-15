import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProjectTools } from '@ottocode/sdk';
import { preprocessFileMentionsForModel } from '../packages/server/src/runtime/message/file-mentions.ts';

describe('file mention preprocessing', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `otto-file-mentions-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
	});

	test('removes @ from valid file mentions and appends content', async () => {
		await fs.writeFile(
			join(tempDir, 'publish.env'),
			'cli=false\ndesktop=false\n',
		);

		const result = await preprocessFileMentionsForModel({
			text: 'update @publish.env set cli and desktop to true',
			projectRoot: tempDir,
		});

		expect(result.text).toContain(
			'update publish.env set cli and desktop to true',
		);
		expect(result.text).not.toContain('update @publish.env');
		expect(result.text).toContain('<mentioned-file path="publish.env"');
		expect(result.text).toContain('cli=false\ndesktop=false');
		expect(result.mentionedFiles).toHaveLength(1);
	});

	test('marks explicitly mentioned files as freshly read for edits', async () => {
		await fs.writeFile(
			join(tempDir, 'publish.env'),
			'PUBLISH_CLI=false\nPUBLISH_DESKTOP=false\n',
		);

		await preprocessFileMentionsForModel({
			text: 'update @publish.env set cli and desktop to true',
			projectRoot: tempDir,
		});

		const { tools } = await discoverProjectTools(tempDir);
		const editTool = tools.find((tool) => tool.name === 'edit');
		const result = await editTool?.tool.execute({
			path: 'publish.env',
			oldString: 'PUBLISH_CLI=false\nPUBLISH_DESKTOP=false',
			newString: 'PUBLISH_CLI=true\nPUBLISH_DESKTOP=true',
		});

		expect(result).toMatchObject({ ok: true });
		expect(await fs.readFile(join(tempDir, 'publish.env'), 'utf-8')).toContain(
			'PUBLISH_CLI=true\nPUBLISH_DESKTOP=true',
		);
	});

	test('keeps non-file @ mentions unchanged', async () => {
		const result = await preprocessFileMentionsForModel({
			text: 'ask @frontend to update @missing.ts',
			projectRoot: tempDir,
		});

		expect(result.text).toBe('ask @frontend to update @missing.ts');
		expect(result.mentionedFiles).toHaveLength(0);
	});

	test('truncates huge mentioned files', async () => {
		await fs.writeFile(join(tempDir, 'large.txt'), 'a'.repeat(32));

		const result = await preprocessFileMentionsForModel({
			text: 'summarize @large.txt',
			projectRoot: tempDir,
			maxFileBytes: 8,
			maxTotalBytes: 8,
		});

		expect(result.text).toContain('summarize large.txt');
		expect(result.text).toContain('aaaaaaaa');
		expect(result.text).toContain('truncated="true"');
		expect(result.text).toContain('File content truncated');
	});
});
