import { constants } from 'node:fs';
import { access, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { APIError } from '../errors/api-error.ts';

const MAX_DIRECTORY_ENTRIES = 500;

export interface ProjectDirectoryListing {
	path: string;
	parent: string | null;
	directories: Array<{ name: string; path: string }>;
	truncated: boolean;
}

function projectPathError(error: unknown): APIError {
	const code =
		error && typeof error === 'object' && 'code' in error
			? (error as { code?: unknown }).code
			: undefined;
	if (code === 'ENOENT') {
		return new APIError('Project directory does not exist.', {
			status: 404,
			code: 'project_path_not_found',
			cause: error,
		});
	}
	if (code === 'EACCES' || code === 'EPERM') {
		return new APIError('Project directory is not readable.', {
			status: 403,
			code: 'project_path_unreadable',
			cause: error,
		});
	}
	return new APIError('Project directory is unavailable.', {
		status: 400,
		code: 'project_path_invalid',
		cause: error,
	});
}

/** Resolves and verifies an existing host directory before project use. */
export async function validateProjectDirectory(path: string): Promise<string> {
	if (!isAbsolute(path)) {
		throw new APIError('Project path must be absolute.', {
			status: 400,
			code: 'project_path_not_absolute',
		});
	}

	try {
		const canonicalPath = await realpath(path);
		if (!(await stat(canonicalPath)).isDirectory()) {
			throw new APIError('Project path is not a directory.', {
				status: 400,
				code: 'project_path_not_directory',
			});
		}
		await access(canonicalPath, constants.R_OK | constants.X_OK);
		return canonicalPath;
	} catch (error) {
		if (error instanceof APIError) throw error;
		throw projectPathError(error);
	}
}

/** Lists host directories for an owner-authorized remote project picker. */
export async function listProjectDirectories(
	requestedPath?: string,
): Promise<ProjectDirectoryListing> {
	const canonicalPath = await validateProjectDirectory(
		requestedPath?.trim() || homedir(),
	);

	try {
		const entries = await readdir(canonicalPath, { withFileTypes: true });
		const directories = (
			await Promise.all(
				entries.map(async (entry) => {
					const entryPath = join(canonicalPath, entry.name);
					if (entry.isDirectory()) {
						return { name: entry.name, path: entryPath };
					}
					if (!entry.isSymbolicLink()) return null;
					try {
						if (!(await stat(entryPath)).isDirectory()) return null;
						return { name: entry.name, path: await realpath(entryPath) };
					} catch {
						return null;
					}
				}),
			)
		)
			.filter(
				(entry): entry is { name: string; path: string } => entry !== null,
			)
			.sort((a, b) => a.name.localeCompare(b.name));
		const parent = dirname(canonicalPath);

		return {
			path: canonicalPath,
			parent: parent === canonicalPath ? null : parent,
			directories: directories.slice(0, MAX_DIRECTORY_ENTRIES),
			truncated: directories.length > MAX_DIRECTORY_ENTRIES,
		};
	} catch (error) {
		throw projectPathError(error);
	}
}

export function projectDirectoryName(path: string): string {
	return basename(path) || path;
}
