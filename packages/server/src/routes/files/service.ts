import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '@ottocode/sdk';
import { searchFffFiles } from '@ottocode/sdk/search/fff';

const execAsync = promisify(exec);

const EXCLUDED_FILES = new Set(['.DS_Store', 'bun.lockb']);

const HOME_SEARCH_MAX_DEPTH = 3;
const HOME_SEARCH_LIMIT = 500;
const DEFAULT_SEARCH_MAX_DEPTH = 12;
const DEFAULT_SEARCH_LIMIT = 10_000;
export const TREE_ENTRY_LIMIT = 1000;

const EXCLUDED_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'.next',
	'.nuxt',
	'.turbo',
	'.astro',
	'.svelte-kit',
	'.vercel',
	'.output',
	'coverage',
	'.cache',
	'__pycache__',
	'.tsbuildinfo',
	'target',
	'.cargo',
	'.rustup',
	'vendor',
	'.gradle',
	'.idea',
	'.vscode',
]);

type SearchPolicy = {
	maxDepth: number;
	limit: number;
	includeIgnored: boolean;
};

export function isHomeDirectory(projectRoot: string): boolean {
	return resolve(projectRoot) === resolve(homedir());
}

export function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return max;
	return Math.min(Math.max(value, min), max);
}

export function getSearchPolicy(projectRoot: string): SearchPolicy {
	if (isHomeDirectory(projectRoot)) {
		return {
			maxDepth: HOME_SEARCH_MAX_DEPTH,
			limit: HOME_SEARCH_LIMIT,
			includeIgnored: false,
		};
	}
	return {
		maxDepth: DEFAULT_SEARCH_MAX_DEPTH,
		limit: DEFAULT_SEARCH_LIMIT,
		includeIgnored: false,
	};
}

export function shouldExcludeFile(name: string): boolean {
	return EXCLUDED_FILES.has(name);
}

export function shouldExcludeDir(name: string): boolean {
	return EXCLUDED_DIRS.has(name);
}

function shouldExcludeSearchDir(name: string): boolean {
	return shouldExcludeDir(name) || name.startsWith('.');
}

export async function listFilesWithSearch(
	projectRoot: string,
	maxDepth: number,
	limit: number,
	_includeIgnored = false,
	query = '',
): Promise<{ files: string[]; truncated: boolean }> {
	try {
		const result = await searchFffFiles({
			projectRoot,
			maxDepth,
			limit,
			query,
			exclude: Array.from(EXCLUDED_DIRS, (dir) => `${dir}/`),
		});
		return {
			files: result.files.filter((f) => {
				if (f.split(/[\\/]/).some((part) => shouldExcludeSearchDir(part))) {
					return false;
				}
				const filename = f.split(/[\\/]/).pop() || f;
				return !shouldExcludeFile(filename);
			}),
			truncated: result.truncated,
		};
	} catch (error) {
		logger.warn('FFF file search failed, falling back', {
			error: String(error),
		} as Record<string, unknown>);
		return { files: [], truncated: false };
	}
}

export async function parseGitignore(
	projectRoot: string,
): Promise<Set<string>> {
	const patterns = new Set<string>();
	try {
		const gitignorePath = join(projectRoot, '.gitignore');
		const content = await readFile(gitignorePath, 'utf-8');
		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith('#')) {
				patterns.add(trimmed);
			}
		}
	} catch (_err) {}
	return patterns;
}

export function matchesGitignorePattern(
	relativePath: string,
	patterns: Set<string>,
): boolean {
	for (const pattern of patterns) {
		const cleanPattern = pattern.replace(/^\//, '').replace(/\/$/, '');
		const pathParts = relativePath.split(/[\\/]/);

		if (pattern.endsWith('/')) {
			if (pathParts[0] === cleanPattern) return true;
			if (relativePath.startsWith(`${cleanPattern}/`)) return true;
		}

		if (pattern.includes('*')) {
			const regex = new RegExp(
				`^${cleanPattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
			);
			if (regex.test(relativePath)) return true;
			for (const part of pathParts) {
				if (regex.test(part)) return true;
			}
		} else {
			if (relativePath === cleanPattern) return true;
			if (pathParts.includes(cleanPattern)) return true;
			if (relativePath.startsWith(`${cleanPattern}/`)) return true;
		}
	}
	return false;
}

export async function traverseDirectory(
	dir: string,
	projectRoot: string,
	maxDepth: number,
	currentDepth = 0,
	limit: number,
	collected: string[] = [],
	gitignorePatterns?: Set<string>,
): Promise<{ files: string[]; truncated: boolean }> {
	if (currentDepth >= maxDepth || collected.length >= limit) {
		return { files: collected, truncated: collected.length >= limit };
	}

	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (collected.length >= limit) {
				return { files: collected, truncated: true };
			}

			const fullPath = join(dir, entry.name);
			const relativePath = relative(projectRoot, fullPath);

			if (entry.isDirectory()) {
				if (shouldExcludeSearchDir(entry.name)) continue;
				if (
					gitignorePatterns &&
					matchesGitignorePattern(relativePath, gitignorePatterns)
				) {
					continue;
				}
				const result = await traverseDirectory(
					fullPath,
					projectRoot,
					maxDepth,
					currentDepth + 1,
					limit,
					collected,
					gitignorePatterns,
				);
				if (result.truncated) {
					return result;
				}
			} else if (entry.isFile()) {
				if (shouldExcludeFile(entry.name)) continue;
				if (
					gitignorePatterns &&
					matchesGitignorePattern(relativePath, gitignorePatterns)
				) {
					continue;
				}
				collected.push(relativePath);
			}
		}
	} catch (err) {
		logger.warn(
			`Failed to read directory ${dir}:`,
			err as Record<string, unknown>,
		);
	}

	return { files: collected, truncated: false };
}

export async function getChangedFiles(
	projectRoot: string,
): Promise<Map<string, string>> {
	try {
		const { stdout } = await execAsync('git status --porcelain', {
			cwd: projectRoot,
		});
		const changedFiles = new Map<string, string>();
		for (const line of stdout.split('\n')) {
			if (line.length > 3) {
				const statusCode = line.substring(0, 2).trim();
				const filePath = line.substring(3).trim();

				let status = 'modified';
				if (statusCode.includes('A')) status = 'added';
				else if (statusCode.includes('M')) status = 'modified';
				else if (statusCode.includes('D')) status = 'deleted';
				else if (statusCode.includes('R')) status = 'renamed';
				else if (statusCode.includes('?')) status = 'untracked';

				changedFiles.set(filePath, status);
			}
		}
		return changedFiles;
	} catch (_err) {
		return new Map();
	}
}

export async function getGitIgnoredFiles(
	projectRoot: string,
	files: string[],
): Promise<Set<string>> {
	if (files.length === 0) return new Set();
	try {
		return new Promise((resolve) => {
			const proc = spawn('git', ['check-ignore', '--stdin'], {
				cwd: projectRoot,
			});
			let stdout = '';
			proc.stdout.on('data', (data) => {
				stdout += data.toString();
			});
			proc.on('close', () => {
				resolve(new Set(stdout.split('\n').filter(Boolean)));
			});
			proc.on('error', () => {
				resolve(new Set());
			});
			proc.stdin.write(files.join('\n'));
			proc.stdin.end();
		});
	} catch (_err) {
		return new Set();
	}
}
