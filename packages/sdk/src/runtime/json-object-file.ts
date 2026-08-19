import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export type JsonObject = Record<string, unknown>;

type AtomicWriteOperations = {
	mkdir: typeof fs.mkdir;
	writeFile: typeof fs.writeFile;
	rename: typeof fs.rename;
	rm: typeof fs.rm;
	chmod: typeof fs.chmod;
};

export type AtomicJsonWriteOptions = {
	mode?: number;
	operations?: Partial<AtomicWriteOperations>;
};

/** Read a JSON object, returning undefined for missing, malformed, or non-object files. */
export async function readOptionalJsonObject(
	filePath: string,
): Promise<JsonObject | undefined> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as JsonObject)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Atomically replace a JSON object file and always remove the temporary file. */
export async function atomicWriteJsonObject(
	filePath: string,
	value: JsonObject,
	options: AtomicJsonWriteOptions = {},
): Promise<void> {
	const operations: AtomicWriteOperations = { ...fs, ...options.operations };
	await operations.mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
	try {
		await operations.writeFile(temporaryPath, JSON.stringify(value, null, 2), {
			encoding: 'utf8',
			...(options.mode === undefined ? {} : { mode: options.mode }),
		});
		await operations.rename(temporaryPath, filePath);
		if (options.mode !== undefined) {
			await operations.chmod(filePath, options.mode).catch(() => {});
		}
	} finally {
		await operations.rm(temporaryPath, { force: true }).catch(() => {});
	}
}
