import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { createReadStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expandTilde, isAbsoluteLike, resolveSafePath } from './util.ts';
import DESCRIPTION from './tree.txt' with { type: 'text' };
import { toIgnoredBasenames } from '../ignore.ts';
import { createToolError, type ToolResponse } from '../../error.ts';

const FILE_TYPE_SAMPLE_BYTES = 64 * 1024;

type IgnoreMatcher = (relativePath: string, name: string) => boolean;

function createIgnoreMatcher(extra?: string[]): IgnoreMatcher {
	const basenames = toIgnoredBasenames();
	const globs: Bun.Glob[] = [];

	for (const rawPattern of extra ?? []) {
		const pattern = String(rawPattern)
			.replace(/^!/, '')
			.replace(/\\/g, '/')
			.replace(/\/$/, '');
		if (!pattern) continue;
		const hasGlobCharacter = ['*', '?', '[', ']', '{', '}'].some((character) =>
			pattern.includes(character),
		);
		if (!pattern.includes('/') && !hasGlobCharacter) {
			basenames.add(pattern);
			continue;
		}
		try {
			globs.push(new Bun.Glob(pattern));
		} catch {}
	}

	return (relativePath, name) =>
		basenames.has(name) ||
		globs.some((glob) => glob.match(relativePath) || glob.match(name));
}

function isProbablyText(sample: Uint8Array): boolean {
	if (sample.length === 0) return true;

	let controlBytes = 0;
	for (const byte of sample) {
		if (byte === 0) return false;
		if (
			byte < 0x20 &&
			byte !== 0x09 &&
			byte !== 0x0a &&
			byte !== 0x0c &&
			byte !== 0x0d
		) {
			controlBytes++;
		}
	}
	if (controlBytes / sample.length > 0.05) return false;

	const decoded = new TextDecoder('utf-8').decode(sample);
	let replacementCharacters = 0;
	for (const character of decoded) {
		if (character === '\ufffd') replacementCharacters++;
	}
	return replacementCharacters <= Math.max(2, decoded.length * 0.01);
}

async function isTextFile(path: string): Promise<boolean> {
	const stats = await fs.stat(path);
	if (stats.size === 0) return true;

	const sampleSize = Math.min(FILE_TYPE_SAMPLE_BYTES, stats.size);
	const offsets = new Set([
		0,
		Math.max(0, Math.floor((stats.size - sampleSize) / 2)),
		Math.max(0, stats.size - sampleSize),
	]);
	const handle = await fs.open(path, 'r');
	try {
		for (const offset of offsets) {
			const sample = Buffer.allocUnsafe(sampleSize);
			const { bytesRead } = await handle.read(sample, 0, sampleSize, offset);
			if (!isProbablyText(sample.subarray(0, bytesRead))) return false;
		}
		return true;
	} finally {
		await handle.close();
	}
}

async function countTextFileLines(path: string): Promise<number | null> {
	if (!(await isTextFile(path))) return null;

	let count = 1;
	for await (const chunk of createReadStream(path)) {
		for (const byte of chunk as Buffer) {
			if (byte === 0x0a) count++;
		}
	}
	return count;
}

async function walkTree(
	dir: string,
	isIgnored: IgnoreMatcher,
	maxDepth: number | null,
	currentDepth: number,
	prefix: string,
	relativeDir: string,
): Promise<{ lines: string[]; dirs: number; files: number }> {
	let dirs = 0;
	let files = 0;
	const lines: string[] = [];

	if (maxDepth !== null && currentDepth >= maxDepth)
		return { lines, dirs, files };

	try {
		const rawEntries = await fs.readdir(dir, { withFileTypes: true });
		const entries = rawEntries.map((e) => ({
			name: String(e.name),
			isDir: e.isDirectory(),
		}));

		const filtered = entries
			.filter((e) => !e.name.startsWith('.'))
			.filter((e) => {
				const relativePath = relativeDir ? `${relativeDir}/${e.name}` : e.name;
				return !isIgnored(relativePath, e.name);
			})
			.sort((a, b) => {
				if (a.isDir && !b.isDir) return -1;
				if (!a.isDir && b.isDir) return 1;
				return a.name.localeCompare(b.name);
			});

		for (let i = 0; i < filtered.length; i++) {
			const entry = filtered[i];
			const isLast = i === filtered.length - 1;
			const connector = isLast ? '└── ' : '├── ';
			const childPrefix = isLast ? '    ' : '│   ';

			if (entry.isDir) {
				dirs++;
				lines.push(`${prefix}${connector}${entry.name}`);
				const relativePath = relativeDir
					? `${relativeDir}/${entry.name}`
					: entry.name;
				const sub = await walkTree(
					join(dir, entry.name),
					isIgnored,
					maxDepth,
					currentDepth + 1,
					`${prefix}${childPrefix}`,
					relativePath,
				);
				lines.push(...sub.lines);
				dirs += sub.dirs;
				files += sub.files;
			} else {
				files++;
				let lineCount = '';
				try {
					const count = await countTextFileLines(join(dir, entry.name));
					if (count !== null) lineCount = ` (${count} lines)`;
				} catch {}
				lines.push(`${prefix}${connector}${entry.name}${lineCount}`);
			}
		}
	} catch {
		return { lines, dirs, files };
	}

	return { lines, dirs, files };
}

export function buildTreeTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const tree = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			path: z.string().default('.'),
			depth: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe('Optional depth limit (defaults to full depth).'),
			ignore: z
				.array(z.string())
				.optional()
				.describe('List of directory names/globs to ignore'),
		}),
		async execute({
			path,
			depth,
			ignore,
		}: {
			path: string;
			depth?: number;
			ignore?: string[];
		}): Promise<
			ToolResponse<{ path: string; depth: number | null; tree: string }>
		> {
			const req = expandTilde(path || '.');
			const start = isAbsoluteLike(req)
				? req
				: resolveSafePath(projectRoot, req || '.');
			const isIgnored = createIgnoreMatcher(ignore);

			try {
				await fs.access(start);
			} catch {
				return createToolError(
					`tree failed for ${req}: directory not found`,
					'not_found',
					{
						parameter: 'path',
						value: req,
						suggestion: 'Check if the directory exists',
					},
				);
			}

			try {
				const result = await walkTree(
					start,
					isIgnored,
					depth ?? null,
					0,
					'',
					'',
				);
				const header = '.';
				const summary = `\n${result.dirs} director${result.dirs === 1 ? 'y' : 'ies'}, ${result.files} file${result.files === 1 ? '' : 's'}`;
				const output = [header, ...result.lines, summary].join('\n');
				return { ok: true, path: req, depth: depth ?? null, tree: output };
			} catch (error: unknown) {
				const err = error as { message?: string };
				return createToolError(
					`tree failed for ${req}: ${err.message || 'unknown error'}`,
					'execution',
					{
						parameter: 'path',
						value: req,
						suggestion: 'Check if the directory exists and is accessible',
					},
				);
			}
		},
	});
	return { name: 'tree', tool: tree };
}
