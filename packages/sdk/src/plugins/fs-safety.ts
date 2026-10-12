import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Asserts `target` is strictly inside `root` (never equal, never a parent or
 * sibling, no `.`/`..` segments). Returns the resolved target path.
 */
export function assertStrictDescendant(root: string, target: string): string {
	const resolvedRoot = resolve(root);
	const resolvedTarget = resolve(target);
	const rel = relative(resolvedRoot, resolvedTarget);
	if (
		!rel ||
		isAbsolute(rel) ||
		rel
			.split(sep)
			.some((segment) => segment === '' || segment === '.' || segment === '..')
	) {
		throw new Error(
			`Refusing to modify '${resolvedTarget}': not strictly inside '${resolvedRoot}'`,
		);
	}
	return resolvedTarget;
}

async function realpathOrNull(path: string): Promise<string | null> {
	try {
		return await realpath(path);
	} catch {
		return null;
	}
}

/**
 * Recursively removes `target` only after asserting it is a strict descendant
 * of `root`, both lexically and through symlinks of its parent directory.
 */
export async function removeDescendantPath(
	root: string,
	target: string,
): Promise<void> {
	const resolvedTarget = assertStrictDescendant(root, target);
	const realRoot = await realpathOrNull(root);
	if (!realRoot) return;
	const realParent = await realpathOrNull(dirname(resolvedTarget));
	if (!realParent) return;
	if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
		throw new Error(
			`Refusing to modify '${resolvedTarget}': parent resolves outside '${realRoot}'`,
		);
	}
	await rm(resolvedTarget, { recursive: true, force: true });
}

const writeQueues = new Map<string, Promise<unknown>>();

/** Serializes async work per key (e.g. per file path). */
export function serializeByKey<T>(
	key: string,
	task: () => Promise<T>,
): Promise<T> {
	const previous = writeQueues.get(key) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(task);
	const tail = run.catch(() => {});
	writeQueues.set(key, tail);
	void tail.then(() => {
		if (writeQueues.get(key) === tail) writeQueues.delete(key);
	});
	return run;
}

/** Writes text via temp file + rename so readers never see partial content. */
export async function atomicWriteText(
	path: string,
	content: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporaryPath, content, 'utf8');
	try {
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}
