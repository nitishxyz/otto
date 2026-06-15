import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
	mkdtemp,
	mkdir,
	readFile,
	writeFile,
	rm,
	chmod,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverProjectTools } from '@ottocode/sdk';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const onePixelPngBase64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUdGqwAAAABJRU5ErkJggg==';

async function resolveStreamedResult(value: unknown): Promise<unknown> {
	if (!value || typeof value !== 'object' || !(Symbol.asyncIterator in value)) {
		return value;
	}

	let result: unknown;
	for await (const chunk of value as AsyncIterable<{ result?: unknown }>) {
		if (chunk.result !== undefined) result = chunk.result;
	}
	return result;
}

async function collectStreamedShell(value: unknown): Promise<{
	result: unknown;
	output: string;
}> {
	if (!value || typeof value !== 'object' || !(Symbol.asyncIterator in value)) {
		return { result: value, output: '' };
	}

	let result: unknown;
	let output = '';
	for await (const chunk of value as AsyncIterable<{
		channel?: string;
		delta?: string;
		result?: unknown;
	}>) {
		if (chunk.channel === 'output' && typeof chunk.delta === 'string') {
			output += chunk.delta;
		}
		if (chunk.result !== undefined) result = chunk.result;
	}
	return { result, output };
}

let testDir: string;
let projectRoot: string;

beforeAll(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'otto-tools-test-'));
	projectRoot = join(testDir, 'project');
	await mkdir(projectRoot, { recursive: true });

	// Initialize git repo for git tools
	await execAsync('git init', { cwd: projectRoot });
	await execAsync('git config user.email "test@example.com"', {
		cwd: projectRoot,
	});
	await execAsync('git config user.name "Test User"', { cwd: projectRoot });

	// Create test files
	await writeFile(
		join(projectRoot, 'test.txt'),
		'Hello World\nLine 2\nLine 3\n',
	);
	await writeFile(
		join(projectRoot, 'example.ts'),
		'export function test() {\n  return "test";\n}\n',
	);
	await mkdir(join(projectRoot, 'subdir'), { recursive: true });
	await writeFile(join(projectRoot, 'subdir', 'file.ts'), 'const x = 1;\n');
	await writeFile(
		join(projectRoot, 'pixel.png'),
		Buffer.from(onePixelPngBase64, 'base64'),
	);
});

afterAll(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe('Built-in Tools', () => {
	it('should discover all built-in tools', async () => {
		const { tools } = await discoverProjectTools(projectRoot);
		const names = tools.map((t) => t.name);

		expect(names).toContain('read');
		expect(names).toContain('load_tools');
		expect(names).toContain('edit');
		expect(names).toContain('multiedit');
		expect(names).toContain('write');
		expect(names).toContain('copy_into');
		expect(names).toContain('ls');
		expect(names).toContain('tree');
		expect(names).toContain('shell');
		expect(names).toContain('git_status');
		expect(names).toContain('git_diff');
		expect(names).toContain('git_commit');
		expect(names).toContain('search');
		expect(names).toContain('glob');
		expect(names).toContain('apply_patch');
		expect(names).toContain('progress_update');
		expect(names).toContain('websearch');
		expect(names).toContain('update_todos');
	});

	describe('read tool', () => {
		it('should read entire file', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');
			expect(readTool).toBeDefined();

			const result = await readTool?.tool.execute({ path: 'test.txt' });
			expect(result).toHaveProperty('content');
			expect((result as { content: string }).content).toContain('Hello World');
		});

		it('should read file with line range', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');

			const result = await readTool?.tool.execute({
				path: 'test.txt',
				startLine: 1,
				endLine: 2,
			});
			expect(result).toHaveProperty('content');
			expect((result as { content: string }).content).toBe(
				'Hello World\nLine 2',
			);
			expect((result as { lineRange: string }).lineRange).toBe('@1-2');
		});

		it('should read one line when only startLine is provided', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');

			const result = await readTool?.tool.execute({
				path: 'test.txt',
				startLine: 2,
			});

			expect((result as { content: string }).content).toBe('Line 2');
			expect((result as { lineRange: string }).lineRange).toBe('@2-2');
		});

		it('should read maxLines from startLine', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');

			const result = await readTool?.tool.execute({
				path: 'test.txt',
				startLine: 2,
				maxLines: 2,
			});

			expect((result as { content: string }).content).toBe('Line 2\nLine 3');
			expect((result as { lineRange: string }).lineRange).toBe('@2-3');
		});
	});

	describe('read_image tool', () => {
		it('should read image content for vision models', async () => {
			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const imageTool = lazyToolsRecord.read_image;
			expect(imageTool).toBeDefined();

			const result = await imageTool?.execute?.({ path: 'pixel.png' });
			expect(result).toHaveProperty('mediaType');
			expect((result as { mediaType: string }).mediaType).toBe('image/png');
			expect((result as { data: string }).data.length).toBeGreaterThan(0);

			const modelOutput = await imageTool?.toModelOutput?.({
				toolCallId: 'call-1',
				input: { path: 'pixel.png' },
				output: result,
			});
			expect(modelOutput).toHaveProperty('type', 'content');
			expect(
				(modelOutput as { value: Array<{ type: string }> }).value.some(
					(part) => part.type === 'image-data',
				),
			).toBe(true);
		});
	});

	describe('write tool', () => {
		it('should write content to file', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const writeTool = tools.find((t) => t.name === 'write');

			const result = await writeTool?.tool.execute({
				path: 'new-file.txt',
				content: 'test content',
			});
			expect(result).toHaveProperty('bytes');
			expect((result as { bytes: number }).bytes).toBe(12);
			expect(
				(result as { artifact?: { kind?: string; patch?: string } }).artifact,
			).toMatchObject({ kind: 'file_diff' });
		});
	});

	describe('copy_into tool', () => {
		it('should copy a source line range into a target file', async () => {
			await writeFile(join(projectRoot, 'copy-source.txt'), 'A\nB\nC\n');
			await writeFile(join(projectRoot, 'copy-target.txt'), 'one\ntwo\n');
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');
			const copyIntoTool = tools.find((t) => t.name === 'copy_into');

			await readTool?.tool.execute({ path: 'copy-target.txt' });
			const result = await copyIntoTool?.tool.execute({
				sourcePath: 'copy-source.txt',
				startLine: 2,
				endLine: 3,
				targetPath: 'copy-target.txt',
				insertAtLine: 2,
			});

			expect(result).toMatchObject({ ok: true, linesCopied: 2 });
			expect(
				await readFile(join(projectRoot, 'copy-target.txt'), 'utf-8'),
			).toBe('one\nB\nC\ntwo\n');
		});

		it('should replace a target line range', async () => {
			await writeFile(join(projectRoot, 'copy-replace-source.txt'), 'X\nY\n');
			await writeFile(
				join(projectRoot, 'copy-replace-target.txt'),
				'a\nb\nc\n',
			);
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');
			const copyIntoTool = tools.find((t) => t.name === 'copy_into');

			await readTool?.tool.execute({ path: 'copy-replace-target.txt' });
			const result = await copyIntoTool?.tool.execute({
				sourcePath: 'copy-replace-source.txt',
				startLine: 1,
				endLine: 2,
				targetPath: 'copy-replace-target.txt',
				mode: 'replace_range',
				targetStartLine: 2,
				targetEndLine: 2,
			});

			expect(result).toMatchObject({ ok: true, linesCopied: 2 });
			expect(
				await readFile(join(projectRoot, 'copy-replace-target.txt'), 'utf-8'),
			).toBe('a\nX\nY\nc\n');
		});

		it('should accept end and append shorthands', async () => {
			await writeFile(join(projectRoot, 'copy-end-source.txt'), 'A\nB\nC\n');
			await writeFile(join(projectRoot, 'copy-end-target.txt'), 'one\n');
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');
			const copyIntoTool = tools.find((t) => t.name === 'copy_into');

			await readTool?.tool.execute({ path: 'copy-end-target.txt' });
			const result = await copyIntoTool?.tool.execute({
				sourcePath: 'copy-end-source.txt',
				startLine: 2,
				endLine: 'end',
				targetPath: 'copy-end-target.txt',
				insertAtLine: 'append',
			});

			expect(result).toMatchObject({
				ok: true,
				linesCopied: 2,
				sourceRange: '2-3',
			});
			expect(
				await readFile(join(projectRoot, 'copy-end-target.txt'), 'utf-8'),
			).toBe('one\nB\nC\n');
		});

		it('should clamp end ranges that exceed file length', async () => {
			await writeFile(join(projectRoot, 'copy-clamp-source.txt'), 'X\nY\n');
			await writeFile(join(projectRoot, 'copy-clamp-target.txt'), 'a\nb\n');
			const { tools } = await discoverProjectTools(projectRoot);
			const readTool = tools.find((t) => t.name === 'read');
			const copyIntoTool = tools.find((t) => t.name === 'copy_into');

			await readTool?.tool.execute({ path: 'copy-clamp-target.txt' });
			const result = await copyIntoTool?.tool.execute({
				sourcePath: 'copy-clamp-source.txt',
				startLine: 1,
				endLine: 999,
				targetPath: 'copy-clamp-target.txt',
				mode: 'replace_range',
				targetStartLine: 1,
				targetEndLine: 999,
			});

			expect(result).toMatchObject({
				ok: true,
				sourceRange: '1-2',
				targetRange: '1-2',
			});
			expect(
				await readFile(join(projectRoot, 'copy-clamp-target.txt'), 'utf-8'),
			).toBe('X\nY\n');
		});
	});

	describe('ls tool', () => {
		it('should list directory contents', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const lsTool = tools.find((t) => t.name === 'ls');

			const result = await lsTool?.tool.execute({ path: '.' });
			expect(result).toHaveProperty('entries');
			expect(Array.isArray((result as { entries: unknown[] }).entries)).toBe(
				true,
			);
		});
	});

	describe('tree tool', () => {
		it('should show directory tree', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const treeTool = tools.find((t) => t.name === 'tree');

			const result = await treeTool?.tool.execute({ path: '.', depth: 2 });
			expect(result).toHaveProperty('tree');
			expect(typeof (result as { tree: string }).tree).toBe('string');
		});
	});

	describe('shell tool', () => {
		it('should load login PATH without sourcing interactive startup per command', async () => {
			if (process.platform === 'win32') return;

			const originalHome = process.env.HOME;
			const originalShell = process.env.SHELL;
			const originalPath = process.env.PATH;
			const home = join(testDir, 'shell-home');
			const binDir = join(testDir, 'shell-bin');
			const commandPath = join(binDir, 'otto-shell-path-test');
			await mkdir(home, { recursive: true });
			await mkdir(binDir, { recursive: true });
			await writeFile(commandPath, '#!/bin/sh\necho startup-path-ok\n');
			await chmod(commandPath, 0o755);
			await writeFile(
				join(home, '.bash_profile'),
				`export PATH="${binDir}:$PATH"\nexport OTTO_SHELL_RC_TEST=rc-loaded\n`,
			);

			try {
				process.env.HOME = home;
				process.env.SHELL = '/bin/bash';
				process.env.PATH = '/usr/bin:/bin';

				const { tools } = await discoverProjectTools(projectRoot);
				const shellTool = tools.find((t) => t.name === 'shell');
				const result = await resolveStreamedResult(
					await shellTool?.tool.execute({
						cmd: 'otto-shell-path-test && printf "rc=%s\\n" "$OTTO_SHELL_RC_TEST"',
					}),
				);

				expect(result).toMatchObject({ ok: true });
				expect((result as { stdout: string }).stdout).toContain(
					'startup-path-ok',
				);
				expect((result as { stdout: string }).stdout).toContain('rc=\n');
			} finally {
				if (originalHome === undefined) delete process.env.HOME;
				else process.env.HOME = originalHome;
				if (originalShell === undefined) delete process.env.SHELL;
				else process.env.SHELL = originalShell;
				if (originalPath === undefined) delete process.env.PATH;
				else process.env.PATH = originalPath;
			}
		});

		it('should execute shell commands', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');

			const result = await resolveStreamedResult(
				await shellTool?.tool.execute({ cmd: 'echo "test"' }),
			);
			expect(result).toHaveProperty('stdout');
			expect((result as { stdout: string }).stdout).toContain('test');
		});

		it('should tail shell output when requested', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');

			const { result, output } = await collectStreamedShell(
				await shellTool?.tool.execute({
					cmd: 'printf "one\\ntwo\\nthree\\n"',
					outputMode: 'tail',
					tailLines: 2,
				}),
			);
			expect(result).toMatchObject({ ok: true, outputMode: 'tail' });
			expect((result as { stdout: string }).stdout).toBe('two\nthree\n');
			expect(output).toBe('one\ntwo\nthree\n');
		});

		it('should cap large final shell outputs by bytes', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');

			const result = await resolveStreamedResult(
				await shellTool?.tool.execute({
					cmd: 'python3 - <<\'PY\'\nprint("x" * 5000)\nPY',
					outputMode: 'full',
					maxOutputBytes: 1000,
				}),
			);

			expect((result as { stdout: string }).stdout.length).toBeLessThan(1500);
			expect((result as { stdoutTruncated?: boolean }).stdoutTruncated).toBe(
				true,
			);
		});

		it('should handle command errors', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');

			const result = await resolveStreamedResult(
				await shellTool?.tool.execute({ cmd: 'exit 1' }),
			);
			expect(result).toMatchObject({ ok: false });
		});

		it('should abort long-running shell commands promptly', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');
			const controller = new AbortController();
			const startedAt = Date.now();

			const resultPromise = resolveStreamedResult(
				await shellTool?.tool.execute(
					{ cmd: 'sleep 10' },
					{ abortSignal: controller.signal },
				),
			);
			setTimeout(() => controller.abort(), 50);

			const result = await resultPromise;
			expect(result).toMatchObject({ ok: false, errorType: 'abort' });
			expect(Date.now() - startedAt).toBeLessThan(3000);
		});

		it('should allow repository search commands', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');

			const result = await resolveStreamedResult(
				await shellTool?.tool.execute({
					cmd: 'grep -R "Hello" .',
				}),
			);

			expect(result).toMatchObject({ ok: true, exitCode: 0 });
			expect((result as { stdout: string }).stdout).toContain('Hello World');
			expect((result as { discoveryHint?: string }).discoveryHint).toContain(
				'prefer the search tool',
			);
		});

		it('should hint to use glob for repository file discovery commands', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const shellTool = tools.find((t) => t.name === 'shell');

			const result = await resolveStreamedResult(
				await shellTool?.tool.execute({
					cmd: 'find . -name "*.ts"',
				}),
			);

			expect(result).toMatchObject({ ok: true, exitCode: 0 });
			expect((result as { discoveryHint?: string }).discoveryHint).toContain(
				'prefer the glob tool',
			);
		});
	});

	describe('git tools', () => {
		it('git_status should show repository status', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const gitStatusTool = tools.find((t) => t.name === 'git_status');

			const result = await gitStatusTool?.tool.execute({});
			expect(result).toHaveProperty('staged');
			expect(result).toHaveProperty('unstaged');
		});

		it('git_diff should show diff', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const gitDiffTool = tools.find((t) => t.name === 'git_diff');

			const result = await gitDiffTool?.tool.execute({ all: false });
			expect(result).toHaveProperty('patch');
			expect(typeof (result as { patch: string }).patch).toBe('string');
		});
	});

	describe('search tool', () => {
		it('should search for patterns', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const searchTool = tools.find((t) => t.name === 'search');

			const result = await searchTool?.tool.execute({
				query: 'Hello',
				path: '.',
			});
			expect(result).toHaveProperty('matches');
			expect(Array.isArray((result as { matches: unknown[] }).matches)).toBe(
				true,
			);
		});

		it('should handle no matches gracefully', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const searchTool = tools.find((t) => t.name === 'search');

			const result = await searchTool?.tool.execute({
				query: 'NONEXISTENT_STRING_XYZ',
				path: '.',
			});
			expect((result as { count: number }).count).toBe(0);
		});

		it('should stop at a global maxResults limit', async () => {
			await writeFile(join(projectRoot, 'many-a.txt'), 'needle\nneedle\n');
			await writeFile(join(projectRoot, 'many-b.txt'), 'needle\nneedle\n');
			const { tools } = await discoverProjectTools(projectRoot);
			const searchTool = tools.find((t) => t.name === 'search');

			const result = await searchTool?.tool.execute({
				query: 'needle',
				path: '.',
				maxResults: 2,
			});

			expect((result as { count: number }).count).toBe(2);
			expect((result as { matches: unknown[] }).matches).toHaveLength(2);
			expect((result as { truncated?: boolean }).truncated).toBe(true);
		});
	});

	describe('grep tool', () => {
		it('should search in files', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const grepTool = tools.find((t) => t.name === 'search');

			const result = await grepTool?.tool.execute({
				query: 'Hello',
				path: '.',
			});
			expect(result).toHaveProperty('matches');
			expect(result).toHaveProperty('count');
		});

		it('should support file includes', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const grepTool = tools.find((t) => t.name === 'search');

			const result = await grepTool?.tool.execute({
				query: 'export',
				path: '.',
				glob: ['*.ts'],
			});
			expect(result).toHaveProperty('matches');
			expect(result).toHaveProperty('count');
		});

		it('should treat multiple include globs as alternatives', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const grepTool = tools.find((t) => t.name === 'search');

			const result = await grepTool?.tool.execute({
				query: 'Hello',
				path: '.',
				glob: ['*.ts', '*.txt'],
			});

			expect((result as { count: number }).count).toBeGreaterThan(0);
			expect((result as { matches: Array<{ file: string }> }).matches).toEqual(
				expect.arrayContaining([expect.objectContaining({ file: 'test.txt' })]),
			);
		});
	});

	describe('glob tool', () => {
		it('should find files by pattern', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const globTool = tools.find((t) => t.name === 'glob');

			const result = await globTool?.tool.execute({
				pattern: '*.ts',
				path: 'packages/sdk/src/core/src/tools/builtin',
			});
			expect(result).toHaveProperty('files');
			expect(result).toHaveProperty('count');
			expect(Array.isArray((result as { files: unknown }).files)).toBe(true);
		});

		it('should support glob patterns', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const globTool = tools.find((t) => t.name === 'glob');

			const result = await globTool?.tool.execute({
				pattern: '**/*.txt',
				path: 'packages/sdk/src/core/src/tools/builtin',
				limit: 10,
			});
			expect(result).toHaveProperty('files');
			expect(result).toHaveProperty('count');
		});

		it('should ignore dependency directories by default but allow direct paths', async () => {
			await mkdir(join(projectRoot, 'node_modules', 'pkg'), {
				recursive: true,
			});
			await writeFile(
				join(projectRoot, 'node_modules', 'pkg', 'metadata.ts'),
				'export const ignored = true;\n',
			);
			const { tools } = await discoverProjectTools(projectRoot);
			const globTool = tools.find((t) => t.name === 'glob');

			const defaultResult = await globTool?.tool.execute({
				pattern: '**/{layout,page,metadata}.{ts,tsx,js,jsx}',
				path: '.',
				limit: 100,
			});

			expect((defaultResult as { files: string[] }).files).not.toContain(
				'node_modules/pkg/metadata.ts',
			);

			const directResult = await globTool?.tool.execute({
				pattern: '**/*.ts',
				path: 'node_modules',
				limit: 10,
			});

			expect((directResult as { files: string[] }).files).toContain(
				'pkg/metadata.ts',
			);
		});
	});

	describe('progress_update tool', () => {
		it('should update progress', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const progressTool = tools.find((t) => t.name === 'progress_update');

			const result = await progressTool?.tool.execute({
				message: 'Working...',
			});
			expect(result).toEqual({ ok: true });
		});
	});

	describe('update_todos tool', () => {
		it('should update todo items', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const todosTool = tools.find((t) => t.name === 'update_todos');

			const result = await todosTool?.tool.execute({
				todos: [
					{ step: 'Task 1', status: 'completed' },
					{ step: 'Task 2', status: 'in_progress' },
				],
			});
			expect(result).toEqual({ ok: true });
		});
	});

	describe('apply_patch tool', () => {
		it('should apply enveloped patch', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const patchTool = tools.find((t) => t.name === 'apply_patch');

			const patch = `*** Begin Patch
*** Add File: newfile.txt
+This is new content
*** End Patch`;

			const result = await patchTool?.tool.execute({ patch });
			expect(result).toMatchObject({
				ok: true,
				operation: 'apply_patch',
				changed: true,
				summary: { files: 1, additions: 1, deletions: 0 },
			});
			expect(
				(result as { artifact?: { patch?: string } }).artifact?.patch,
			).toContain('@@ -0,0 +1');
		});

		it('should reject empty begin-marker-only patches with a specific error', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const patchTool = tools.find((t) => t.name === 'apply_patch');

			const result = await patchTool?.tool.execute({
				patch: '*** Begin Patch',
			});

			expect(result).toMatchObject({ ok: false, errorType: 'validation' });
			expect((result as { error?: string }).error).toContain(
				'Patch contains no operations',
			);
			expect(
				(result as { details?: { suggestion?: string } }).details?.suggestion,
			).toContain('complete patch body');
		});

		it('should update existing file using enveloped patch', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const patchTool = tools.find((t) => t.name === 'apply_patch');

			const patch = `*** Begin Patch
*** Update File: test.txt
@@
 Hello World
-Line 2
+Line 2 updated
 Line 3
*** End Patch`;

			const result = await patchTool?.tool.execute({ patch });
			expect(result).toHaveProperty('ok', true);
			const change = (result as { changes?: Array<{ hunks: unknown[] }> })
				.changes?.[0] as
				| {
						filePath: string;
						kind: string;
						hunks: Array<{
							oldStart: number;
							newStart: number;
							oldLines: number;
							newLines: number;
							additions: number;
							deletions: number;
							context?: string;
						}>;
				  }
				| undefined;
			expect(change).toBeDefined();
			expect(change).toMatchObject({ filePath: 'test.txt', kind: 'update' });
			const hunk = change?.hunks?.[0];
			expect(hunk).toMatchObject({
				oldStart: 1,
				newStart: 1,
				oldLines: 3,
				newLines: 3,
				additions: 1,
				deletions: 1,
			});
			expect(result).toMatchObject({
				operation: 'apply_patch',
				changed: true,
				summary: { files: 1, additions: 1, deletions: 1 },
			});
			expect(
				(result as { artifact?: { patch?: string } }).artifact?.patch,
			).toContain('@@ -1,3 +1,3 @@');

			const updated = await Bun.file(join(projectRoot, 'test.txt')).text();
			expect(updated).toContain('Line 2 updated');
		});

		it('should accept standard unified diff patches', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const patchTool = tools.find((t) => t.name === 'apply_patch');

			const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@
 Hello World
-Line 2 updated
+Line 2 unified
 Line 3
`;

			const result = await patchTool?.tool.execute({ patch });
			expect(result).toHaveProperty('ok', true);

			const updated = await Bun.file(join(projectRoot, 'test.txt')).text();
			expect(updated).toContain('Line 2 unified');
		});

		it('should allow rejects when requested', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const patchTool = tools.find((t) => t.name === 'apply_patch');

			const patch = `*** Begin Patch
*** Update File: test.txt
@@
 Hello World
-Line 2 unified
+Line 2 final
 Line 3
*** Update File: missing.txt
@@ missing file
-old
+new
*** End Patch`;

			const result = await patchTool?.tool.execute({
				patch,
				allowRejects: true,
			});

			expect(result).toHaveProperty('ok', true);
			const { rejected } = (result ?? {}) as {
				rejected?: Array<{ filePath: string; reason: string }>;
			};
			expect(rejected).toBeDefined();
			expect(rejected?.length).toBe(1);
			expect(rejected?.[0]?.filePath).toBe('missing.txt');
			expect(rejected?.[0]?.reason).toMatch(/File not found/i);

			const updated = await Bun.file(join(projectRoot, 'test.txt')).text();
			expect(updated).toContain('Line 2 final');
		});

		it('should treat already-applied removals as success', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const patchTool = tools.find((t) => t.name === 'apply_patch');

			// Reset file to a state that already omits the removal target.
			await writeFile(
				join(projectRoot, 'test.txt'),
				'Hello World\nLine 3\n',
				'utf-8',
			);
			const patch = `*** Begin Patch
*** Update File: test.txt
-import does.not.exist
-Line 2 final
*** End Patch`;

			const result = await patchTool?.tool.execute({ patch });
			expect(result).toHaveProperty('ok', true);
			const updated = await Bun.file(join(projectRoot, 'test.txt')).text();
			expect(updated).toBe('Hello World\nLine 3\n');
		});
	});

	describe('websearch tool', () => {
		it('should have websearch tool', async () => {
			const { tools } = await discoverProjectTools(projectRoot);
			const websearchTool = tools.find((t) => t.name === 'websearch');

			expect(websearchTool).toBeDefined();
			expect(websearchTool?.name).toBe('websearch');
		});
	});
});
