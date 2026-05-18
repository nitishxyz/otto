import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getGlobalConfigDir } from '../../../../src/config/src/paths.ts';
import { RUST_PTY_LIBS } from './rust-libs.ts';

function resolveLibraryFilename(): string {
	const platform = process.platform;
	const arch = process.arch;

	if (platform === 'darwin') {
		return arch === 'arm64' ? 'librust_pty_arm64.dylib' : 'librust_pty.dylib';
	}

	if (platform === 'win32') {
		return 'rust_pty.dll';
	}

	return arch === 'arm64' ? 'librust_pty_arm64.so' : 'librust_pty.so';
}

function tryUseExistingPath(path?: string | null): string | null {
	if (!path) return null;
	if (existsSync(path)) {
		process.env.BUN_PTY_LIB = path;
		return path;
	}
	return null;
}

async function extractEmbeddedLibrary(
	filename: string,
): Promise<string | null> {
	const platformLibs =
		RUST_PTY_LIBS[process.platform as keyof typeof RUST_PTY_LIBS];
	const embeddedPath =
		platformLibs?.[process.arch === 'arm64' ? 'arm64' : 'x64'];

	if (!embeddedPath) return null;

	const targetDir = join(getGlobalConfigDir(), 'runtime', 'bun-pty');
	mkdirSync(targetDir, { recursive: true });
	const targetPath = join(targetDir, filename);
	const source = Bun.file(embeddedPath);
	await Bun.write(targetPath, source);
	process.env.BUN_PTY_LIB = targetPath;
	return targetPath;
}

export async function ensureBunPtyLibrary(): Promise<string | null> {
	const filename = resolveLibraryFilename();
	if (process.env.OTTO_PREFER_BUNDLED_PTY === '1') {
		const embedded = await extractEmbeddedLibrary(filename);
		if (embedded) return embedded;
	}

	const already = tryUseExistingPath(process.env.BUN_PTY_LIB);
	if (already) return already;

	const candidates: string[] = [];

	candidates.push(
		join(
			process.cwd(),
			'node_modules',
			'bun-pty',
			'rust-pty',
			'target',
			'release',
			filename,
		),
	);

	for (const candidate of candidates) {
		const path = tryUseExistingPath(candidate);
		if (path) return path;
	}

	return extractEmbeddedLibrary(filename);
}
