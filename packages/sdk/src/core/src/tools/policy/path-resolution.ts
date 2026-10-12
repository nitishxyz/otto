import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve as resolvePath,
} from 'node:path';

/**
 * How a relative tool path is anchored.
 * - `session`: relative to the session working directory (set by `cd`),
 *   which itself is relative to the project root.
 * - `project`: relative to the project root, ignoring the session cwd.
 */
export type PathBase = 'session' | 'project';

export type PathScope = 'project' | 'read-only' | 'outside';

export type PathResolutionContext = {
	projectRoot: string;
	/** Session working directory: project-relative or absolute. */
	cwd?: string;
	readOnlyRoots?: readonly string[];
};

export type ResolvedPath = {
	/** Raw value supplied by the caller. */
	input: string;
	/** Lexical absolute path (home expanded, joined with base). */
	absolute: string;
	/** Symlink-resolved path of the target, or of its nearest existing parent. */
	canonical: string;
	exists: boolean;
	isDirectory: boolean;
	scope: PathScope;
	/** Canonical path relative to the canonical project root when in scope. */
	projectRelative?: string;
	/** Configured read-only root (as given) containing the canonical target. */
	readOnlyRoot?: string;
	/** `~/...` form when the canonical target is inside the home directory. */
	homeRelative?: string;
};

function homeDirectory(): string {
	return process.env.HOME || process.env.USERPROFILE || homedir();
}

/** Expands a leading `~` or `~/` to the current user's home directory. */
export function expandHomePath(path: string): string {
	const home = homeDirectory();
	if (!home) return path;
	if (path === '~') return home;
	if (path.startsWith('~/') || path.startsWith('~\\'))
		return join(home, path.slice(2));
	return path;
}

/** True for POSIX absolute, Windows drive-absolute, and `~` paths. */
export function isAbsolutePathLike(path: string): boolean {
	return (
		path.startsWith('/') ||
		path === '~' ||
		path.startsWith('~/') ||
		/^[A-Za-z]:[\\/]/.test(path) ||
		isAbsolute(path)
	);
}

function normalizeForComparison(value: string): string {
	const forward = value.replace(/\\/g, '/');
	const trimmed = forward.length > 1 ? forward.replace(/\/+$/, '') : forward;
	return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/** True when `target` equals `root` or is a descendant of it (no I/O). */
export function isPathWithin(target: string, root: string): boolean {
	const t = normalizeForComparison(target);
	const r = normalizeForComparison(root);
	if (t === r) return true;
	const prefix = r.endsWith('/') ? r : `${r}/`;
	return t.startsWith(prefix);
}

/**
 * Resolves symlinks for an absolute path. When the target does not exist,
 * the nearest existing parent is resolved and the remaining segments are
 * appended, so not-yet-created files still get a canonical location.
 */
export function canonicalizePath(absolutePath: string): {
	canonical: string;
	exists: boolean;
	isDirectory: boolean;
} {
	const lexical = resolvePath(absolutePath);
	const missing: string[] = [];
	let current = lexical;
	for (;;) {
		try {
			const real = realpathSync(current);
			const canonical = missing.length
				? join(real, ...missing.slice().reverse())
				: real;
			if (missing.length) {
				return { canonical, exists: false, isDirectory: false };
			}
			let isDirectory = false;
			try {
				isDirectory = statSync(real).isDirectory();
			} catch {}
			return { canonical, exists: true, isDirectory };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
			try {
				if (lstatSync(current).isSymbolicLink()) {
					throw new Error(`Cannot resolve dangling symlink: ${current}`);
				}
			} catch (linkError) {
				if (
					(linkError as NodeJS.ErrnoException).code !== 'ENOENT' &&
					(linkError as NodeJS.ErrnoException).code !== 'ENOTDIR'
				)
					throw linkError;
			}
			const parent = dirname(current);
			if (parent === current) {
				return { canonical: lexical, exists: false, isDirectory: false };
			}
			missing.push(basename(current));
			current = parent;
		}
	}
}

/** Canonical form of a configured root directory. */
export function canonicalRoot(root: string): string {
	return canonicalizePath(resolvePath(expandHomePath(root))).canonical;
}

function toPortableRelative(path: string): string {
	return path.replace(/\\/g, '/') || '.';
}

/**
 * Resolves a tool path once: expands `~`, anchors relative paths to the
 * session cwd or project root, resolves symlinks, and classifies the
 * canonical target against the project root and read-only roots.
 */
export function resolvePolicyPath(
	input: string,
	context: PathResolutionContext,
	options: { base?: PathBase } = {},
): ResolvedPath {
	const raw = input.trim() || '.';
	const projectRoot = resolvePath(context.projectRoot);
	const expanded = expandHomePath(raw);
	const anchor =
		options.base === 'session' && context.cwd
			? resolvePath(projectRoot, expandHomePath(context.cwd))
			: projectRoot;
	const absolute = isAbsolutePathLike(expanded)
		? resolvePath(expanded)
		: resolvePath(anchor, expanded);
	const { canonical, exists, isDirectory } = canonicalizePath(absolute);

	const resolved: ResolvedPath = {
		input,
		absolute,
		canonical,
		exists,
		isDirectory,
		scope: 'outside',
	};

	const canonicalProjectRoot = canonicalRoot(projectRoot);
	if (isPathWithin(canonical, canonicalProjectRoot)) {
		resolved.scope = 'project';
		resolved.projectRelative = toPortableRelative(
			relative(canonicalProjectRoot, canonical),
		);
	}
	for (const root of context.readOnlyRoots ?? []) {
		if (isPathWithin(canonical, canonicalRoot(root))) {
			resolved.scope = 'read-only';
			resolved.readOnlyRoot = root;
			break;
		}
	}

	const home = homeDirectory();
	if (home) {
		const canonicalHome = canonicalRoot(home);
		if (isPathWithin(canonical, canonicalHome)) {
			const rel = toPortableRelative(relative(canonicalHome, canonical));
			resolved.homeRelative = rel === '.' ? '~' : `~/${rel}`;
		}
	}
	return resolved;
}

/**
 * The value tools should execute with: project-relative for project paths,
 * the configured read-only root joined with the canonical remainder for
 * reference paths, and the canonical absolute path otherwise.
 */
export function toExecutionPath(resolved: ResolvedPath): string {
	if (resolved.scope === 'project') return resolved.projectRelative ?? '.';
	if (resolved.scope === 'read-only' && resolved.readOnlyRoot) {
		const root = resolvePath(expandHomePath(resolved.readOnlyRoot));
		const rel = relative(canonicalRoot(root), resolved.canonical);
		return rel ? join(root, rel) : root;
	}
	return resolved.canonical;
}

/**
 * Resolves `path` relative to `projectRoot` and throws when the lexical or
 * symlink-resolved target escapes the project. Returns the lexical absolute
 * path so callers keep their display semantics.
 */
export function resolveProjectPath(projectRoot: string, path: string): string {
	const root = resolvePath(projectRoot);
	const target = resolvePath(root, path || '.');
	if (!isPathWithin(target, root)) {
		throw new Error(`Path escapes project root: ${path}`);
	}
	const canonical = canonicalizePath(target).canonical;
	if (!isPathWithin(canonical, canonicalRoot(root))) {
		throw new Error(`Path escapes project root via symlink: ${path}`);
	}
	return target;
}
