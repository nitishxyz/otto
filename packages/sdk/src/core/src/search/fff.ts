import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';

export type FffFileSearchResult = {
	files: string[];
	truncated: boolean;
};

type FffResult<T = void> =
	| { ok: true; value: T }
	| { ok: false; error: string };

type FileFinderItem = {
	relativePath: string;
	lineNumber: number;
	lineContent: string;
};

type FileFinderApi = {
	destroy(): void;
	waitForIndexReady(timeoutMs: number): Promise<FffResult>;
	scanFiles(): FffResult;
	waitForScan(timeoutMs: number): Promise<FffResult>;
	grep(
		query: string,
		options: {
			mode: 'regex';
			smartCase: boolean;
			pageSize: number;
			maxMatchesPerFile: number;
		},
	): FffResult<{ items: FileFinderItem[]; nextCursor?: unknown }>;
	fileSearch(
		query: string,
		options: { pageIndex: number; pageSize: number },
	): FffResult<{
		items: Array<{ relativePath: string }>;
		totalMatched: number;
	}>;
	glob(
		query: string,
		options: { pageIndex: number; pageSize: number },
	): FffResult<{
		items: Array<{ relativePath: string }>;
		totalMatched: number;
	}>;
};

type FileFinderModule = {
	FileFinder: {
		create(options: {
			basePath: string;
			aiMode: boolean;
			disableWatch: boolean;
			enableHomeDirScanning: boolean;
			enableFsRootScanning: boolean;
		}): FffResult<FileFinderApi>;
	};
};

type FinderEntry = {
	finder: FileFinderApi;
	ready: Promise<void>;
	lastScanMs: number;
};

const finderCache = new Map<string, Promise<FinderEntry>>();

function normalizeRoot(path: string): string {
	return resolve(path);
}

function isHomeRoot(path: string): boolean {
	return normalizeRoot(path) === normalizeRoot(homedir());
}

async function createFinderEntry(basePath: string): Promise<FinderEntry> {
	const fffPackage = '@ff-labs/fff-bun';
	const { FileFinder } = (await import(fffPackage)) as FileFinderModule;
	const result = FileFinder.create({
		basePath,
		aiMode: true,
		disableWatch: true,
		enableHomeDirScanning: isHomeRoot(basePath),
		enableFsRootScanning: false,
	});
	if (!result.ok) throw new Error(result.error);

	const finder = result.value;
	const entry: FinderEntry = {
		finder,
		ready: Promise.resolve(),
		lastScanMs: 0,
	};
	const ready = (async () => {
		const scan = await finder.waitForIndexReady(10_000);
		if (!scan.ok) throw new Error(scan.error);
		entry.lastScanMs = Date.now();
	})();
	entry.ready = ready;

	return entry;
}

async function getFffEntry(basePath: string): Promise<FinderEntry> {
	const root = normalizeRoot(basePath);
	let entryPromise = finderCache.get(root);
	if (!entryPromise) {
		entryPromise = createFinderEntry(root).catch((error) => {
			finderCache.delete(root);
			throw error;
		});
		finderCache.set(root, entryPromise);
	}

	const entry = await entryPromise;
	await entry.ready;
	return entry;
}

/**
 * Return a cached FFF finder for a root directory.
 */
export async function getFffFinder(basePath: string): Promise<FileFinderApi> {
	const entry = await getFffEntry(basePath);
	return entry.finder;
}

/**
 * Force FFF to rescan a root and wait briefly for fresh results.
 */
export async function refreshFffIndex(
	basePath: string,
	timeoutMs = 3_000,
	maxAgeMs = 0,
): Promise<void> {
	const entry = await getFffEntry(basePath);
	if (maxAgeMs > 0 && Date.now() - entry.lastScanMs < maxAgeMs) return;
	const finder = entry.finder;
	const scan = finder.scanFiles();
	if (!scan.ok) throw new Error(scan.error);
	const done = await finder.waitForScan(timeoutMs);
	if (!done.ok) throw new Error(done.error);
	entry.lastScanMs = Date.now();
}

export function clearFffFinderCache(): void {
	for (const entryPromise of finderCache.values()) {
		entryPromise.then((entry) => entry.finder.destroy()).catch(() => undefined);
	}
	finderCache.clear();
}

function normalizeRelativePath(root: string, path: string): string {
	const rel = relative(root, path).replace(/\\/g, '/');
	return rel === '' ? '.' : rel;
}

function fileDepth(relativePath: string): number {
	if (relativePath === '.') return 0;
	return Math.max(0, relativePath.split(/[\\/]/).length - 1);
}

function isWithinRoot(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function getRootAndConstraint(projectRoot: string, inputPath = '.') {
	const trimmed = inputPath.trim() || '.';
	const expanded =
		trimmed === '~'
			? homedir()
			: trimmed.startsWith('~/')
				? `${homedir()}/${trimmed.slice(2)}`
				: trimmed;
	const target = isAbsolute(expanded)
		? resolve(expanded)
		: resolve(projectRoot, expanded);
	const root = normalizeRoot(projectRoot);

	try {
		const targetStat = await stat(target);
		if (isWithinRoot(root, target)) {
			const rel = normalizeRelativePath(root, target);
			if (rel === '.') return { basePath: root, constraint: '' };
			return {
				basePath: root,
				constraint: targetStat.isDirectory() ? `${rel}/` : rel,
			};
		}

		if (targetStat.isDirectory()) return { basePath: target, constraint: '' };
		return {
			basePath: dirname(target),
			constraint: target.split(/[\\/]/).pop() ?? '',
		};
	} catch {
		if (isWithinRoot(root, target)) {
			const rel = normalizeRelativePath(root, target);
			return { basePath: root, constraint: rel === '.' ? '' : rel };
		}
		return { basePath: target, constraint: '' };
	}
}

export async function resolveFffSearchScope(projectRoot: string, path = '.') {
	return getRootAndConstraint(projectRoot, path);
}

export async function searchFffFiles(args: {
	projectRoot: string;
	query?: string;
	path?: string;
	exclude?: string[];
	maxDepth: number;
	limit: number;
}): Promise<FffFileSearchResult> {
	const { basePath, constraint } = await getRootAndConstraint(
		args.projectRoot,
		args.path ?? '.',
	);
	await refreshFffIndex(basePath, 3_000, 2_000);
	const finder = await getFffFinder(basePath);
	const query = args.query?.trim() ?? '';
	const constraints = [
		constraint,
		...(args.exclude ?? []).map((pattern) => `!${pattern.replace(/^!/, '')}`),
	]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(' ');
	const pageSize = Math.min(Math.max(args.limit * 2, 100), 1_000);
	const files: string[] = [];
	const seen = new Set<string>();
	let truncated = false;

	for (
		let pageIndex = 0;
		pageIndex < 100 && files.length < args.limit;
		pageIndex++
	) {
		const result =
			query || constraints
				? finder.fileSearch(`${constraints ? `${constraints} ` : ''}${query}`, {
						pageIndex,
						pageSize,
					})
				: finder.glob(constraint || '**/*', { pageIndex, pageSize });
		if (!result.ok) throw new Error(result.error);

		for (const item of result.value.items) {
			const relativePath = item.relativePath;
			if (seen.has(relativePath)) continue;
			if (fileDepth(relativePath) >= args.maxDepth) continue;
			seen.add(relativePath);
			files.push(relativePath);
			if (files.length >= args.limit) break;
		}

		const consumed = (pageIndex + 1) * pageSize;
		if (consumed >= result.value.totalMatched) break;
		if (files.length >= args.limit) truncated = true;
	}

	return { files: files.slice(0, args.limit), truncated };
}
