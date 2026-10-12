import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	canonicalRoot,
	resolvePolicyPath,
	resolveProjectPath,
} from '../../policy/path-resolution.ts';
import { formatNormalizedPatch } from './apply-report.ts';
import type { PatchApplicationResult, PatchOperation } from './types.ts';

export type PatchApplyOptions = {
	useFuzzy: boolean;
	allowRejects: boolean;
	readOnlyRoots?: readonly string[];
	/** Resolve and authorize a target before validation or mutation. */
	resolvePath?: (
		root: string,
		path: string,
		kind: PatchOperation['kind'],
	) => string | Promise<string>;
};
function resolvePatchTarget(
	root: string,
	path: string,
	readOnlyRoots?: readonly string[],
): string {
	const absolute = resolveProjectPath(root, path);
	const resolved = resolvePolicyPath(
		absolute,
		{ projectRoot: root, readOnlyRoots },
		{ base: 'project' },
	);
	if (resolved.scope !== 'project') {
		throw new Error(`Patch target is ${resolved.scope}: ${path}`);
	}
	return resolved.canonical;
}

type Target = Readonly<{
	path: string;
	stagePath: string;
	original: Buffer | null;
	mode: number | undefined;
}>;
type PlannedWrite = Readonly<{ target: Target; next: Buffer | null }>;

async function readOptional(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}
function same(a: Buffer | null, b: Buffer | null): boolean {
	return a === null ? b === null : b !== null && a.equals(b);
}
async function replace(
	path: string,
	content: Buffer | null,
	mode?: number,
	exclusive = false,
): Promise<void> {
	if (content === null) {
		await unlink(path);
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.otto-patch-${crypto.randomUUID()}`;
	try {
		await writeFile(temporary, content, { flag: 'wx', mode });
		if (exclusive) await link(temporary, path);
		else await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Validate on an isolated snapshot, then commit the immutable write plan. */
export async function applyValidatedPatch(
	root: string,
	operations: PatchOperation[],
	options: PatchApplyOptions,
	apply: (
		root: string,
		operations: PatchOperation[],
		options: PatchApplyOptions,
	) => Promise<PatchApplicationResult>,
): Promise<PatchApplicationResult> {
	const stage = await mkdtemp(join(tmpdir(), 'otto-patch-plan-'));
	const targets = new Map<string, Target>();
	const names = new Map<string, string>();
	const authorizedPaths: Array<Readonly<{ input: string; path: string }>> = [];
	try {
		const staged: PatchOperation[] = [];
		for (const operation of structuredClone(operations)) {
			const canonical = resolvePatchTarget(
				root,
				operation.filePath,
				options.readOnlyRoots,
			);
			const path = options.resolvePath
				? resolvePatchTarget(
						root,
						await options.resolvePath(root, operation.filePath, operation.kind),
						options.readOnlyRoots,
					)
				: canonical;
			authorizedPaths.push(
				Object.freeze({ input: operation.filePath, path: canonical }),
			);
			let target = targets.get(path);
			if (!target) {
				const original = await readOptional(path);
				const stagePath = String(targets.size);
				const mode = original === null ? undefined : (await stat(path)).mode;
				target = Object.freeze({ path, stagePath, original, mode });
				targets.set(path, target);
				names.set(stagePath, operation.filePath);
				if (original !== null)
					await writeFile(join(stage, stagePath), original);
			}
			staged.push({ ...operation, filePath: target.stagePath });
		}
		let result: PatchApplicationResult;
		try {
			result = await apply(stage, staged, options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const mapped = message.replace(
				/^(\d+):/,
				(prefix, key: string) => `${names.get(key) ?? prefix}:`,
			);
			throw new Error(mapped);
		}
		const plan: readonly PlannedWrite[] = Object.freeze(
			await Promise.all(
				[...targets.values()].map(async (target) =>
					Object.freeze({
						target,
						next: await readOptional(join(stage, target.stagePath)),
					}),
				),
			),
		);
		// Recheck aliases and canonical targets before the first write.
		for (const authorized of authorizedPaths) {
			if (
				resolvePatchTarget(root, authorized.input, options.readOnlyRoots) !==
				authorized.path
			) {
				throw new Error(
					`Patch target changed during validation: ${authorized.input}`,
				);
			}
		}
		// Check every snapshot before the first write, including rejected targets.
		for (const { target } of plan) {
			if (
				resolvePatchTarget(
					canonicalRoot(root),
					target.path,
					options.readOnlyRoots,
				) !== target.path ||
				!same(target.original, await readOptional(target.path))
			)
				throw new Error(
					`Patch target changed during validation: ${target.path}`,
				);
		}
		const applied: PlannedWrite[] = [];
		let failedPath = '';
		try {
			for (const item of plan) {
				if (same(item.target.original, item.next)) continue;
				failedPath = item.target.path;
				await replace(
					failedPath,
					item.next,
					item.target.mode,
					item.target.original === null,
				);
				applied.push(item);
			}
		} catch (error) {
			const rollbackFailures: string[] = [];
			for (const item of [...applied].reverse()) {
				try {
					await replace(
						item.target.path,
						item.target.original,
						item.target.mode,
					);
				} catch {
					rollbackFailures.push(item.target.path);
				}
			}
			throw new Error(
				`Patch commit failed at ${failedPath}: ${error instanceof Error ? error.message : String(error)}. Applied before failure: ${applied.map((item) => item.target.path).join(', ') || 'none'}. ${rollbackFailures.length ? `Rollback failed (still applied): ${rollbackFailures.join(', ')}` : 'All applied writes rolled back.'}`,
			);
		}
		for (const operation of result.operations)
			operation.filePath = names.get(operation.filePath) ?? operation.filePath;
		for (const rejection of result.rejected) {
			rejection.filePath = names.get(rejection.filePath) ?? rejection.filePath;
			rejection.operation = {
				...rejection.operation,
				filePath: rejection.filePath,
			};
		}
		result.normalizedPatch = formatNormalizedPatch(result.operations);
		return result;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
