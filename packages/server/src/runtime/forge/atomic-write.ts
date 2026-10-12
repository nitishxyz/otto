import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const writeQueues = new Map<string, Promise<unknown>>();

function serializeByPath<T>(path: string, task: () => Promise<T>): Promise<T> {
	const previous = writeQueues.get(path) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(task);
	const tail = run.catch(() => {});
	writeQueues.set(path, tail);
	void tail.then(() => {
		if (writeQueues.get(path) === tail) writeQueues.delete(path);
	});
	return run;
}

/**
 * The single Forge file writer: serialized per path, temp file + rename so
 * readers never observe partial content.
 */
export function atomicWriteForgeText(
	path: string,
	content: string,
): Promise<void> {
	return serializeByPath(path, async () => {
		await mkdir(dirname(path), { recursive: true });
		const temporaryPath = `${path}.forge-${crypto.randomUUID()}.tmp`;
		await writeFile(temporaryPath, content, 'utf8');
		try {
			await rename(temporaryPath, path);
		} catch (error) {
			await rm(temporaryPath, { force: true });
			throw error;
		}
	});
}

/** Atomically writes pretty-printed JSON with a trailing newline. */
export function atomicWriteForgeJson(
	path: string,
	value: unknown,
): Promise<void> {
	return atomicWriteForgeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Throws unless `target` is strictly inside `root` (never equal or outside). */
export function assertForgeDescendant(root: string, target: string): string {
	const resolvedRoot = resolve(root);
	const resolvedTarget = resolve(target);
	const rel = relative(resolvedRoot, resolvedTarget);
	if (
		!rel ||
		isAbsolute(rel) ||
		rel.split(sep).some((part) => part === '' || part === '.' || part === '..')
	) {
		throw new Error(
			`Refusing to remove '${resolvedTarget}': not strictly inside '${resolvedRoot}'`,
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
 * Removes `target` (recursively when requested) only after asserting, lexically
 * and through the parent's real path, that it lives strictly inside `root`.
 */
export async function removeForgeDescendant(
	root: string,
	target: string,
	options: { recursive?: boolean } = {},
): Promise<void> {
	const resolvedTarget = assertForgeDescendant(root, target);
	const realRoot = await realpathOrNull(root);
	const realParent = await realpathOrNull(dirname(resolvedTarget));
	if (!realRoot || !realParent) return;
	if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
		throw new Error(
			`Refusing to remove '${resolvedTarget}': parent resolves outside '${realRoot}'`,
		);
	}
	await rm(resolvedTarget, {
		recursive: options.recursive ?? false,
		force: true,
	});
}
