import { stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

type FileStamp = {
	readAt: number;
	mtimeMs?: number;
	ctimeMs?: number;
	size?: number;
};

const readState = new Map<string, Map<string, FileStamp>>();

function getProjectState(projectRoot: string): Map<string, FileStamp> {
	const key = resolvePath(projectRoot);
	let state = readState.get(key);
	if (!state) {
		state = new Map<string, FileStamp>();
		readState.set(key, state);
	}
	return state;
}

async function captureFileStamp(absPath: string): Promise<FileStamp> {
	const stats = await stat(absPath);
	return {
		readAt: Date.now(),
		mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : undefined,
		ctimeMs: Number.isFinite(stats.ctimeMs) ? stats.ctimeMs : undefined,
		size: typeof stats.size === 'number' ? stats.size : undefined,
	};
}

export async function rememberFileRead(
	projectRoot: string,
	absPath: string,
): Promise<void> {
	const state = getProjectState(projectRoot);
	state.set(absPath, await captureFileStamp(absPath));
}

export async function rememberFileWrite(
	projectRoot: string,
	absPath: string,
): Promise<void> {
	const state = getProjectState(projectRoot);
	state.set(absPath, await captureFileStamp(absPath));
}

export async function getStaleReadHint(
	projectRoot: string,
	absPath: string,
	displayPath: string,
): Promise<string | undefined> {
	const state = getProjectState(projectRoot);
	const previous = state.get(absPath);
	if (!previous) {
		return `File ${displayPath} was not read in this session. Read it and copy the exact text before retrying.`;
	}

	let current: FileStamp;
	try {
		current = await captureFileStamp(absPath);
	} catch {
		return undefined;
	}
	const changed =
		current.mtimeMs !== previous.mtimeMs ||
		current.ctimeMs !== previous.ctimeMs ||
		current.size !== previous.size;
	if (!changed) return undefined;

	return `File ${displayPath} has changed since it was last read. Read it again before retrying.`;
}
