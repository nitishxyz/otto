import { join } from 'node:path';
import {
	ensureDir,
	fileExists,
	fs,
	isExecutable,
	makeExecutable,
} from './filesystem.ts';
import { getAgiBinDir, getBinaryFileName, getPlatformKey } from './paths.ts';

function getVendorSearchPaths(binaryName: string): string[] {
	const platformKey = getPlatformKey();
	const paths: string[] = [];

	const tauriResource = process.env.TAURI_RESOURCE_DIR;
	if (tauriResource) {
		paths.push(join(tauriResource, 'vendor', 'bin', platformKey, binaryName));
		paths.push(join(tauriResource, 'vendor', 'bin', binaryName));
	}

	try {
		const exePath = process.execPath;
		if (exePath) {
			const exeDir = join(exePath, '..');
			paths.push(join(exeDir, 'vendor', 'bin', platformKey, binaryName));
			paths.push(
				join(
					exeDir,
					'..',
					'Resources',
					'vendor',
					'bin',
					platformKey,
					binaryName,
				),
			);
		}
	} catch {}

	if (process.env.CARGO_MANIFEST_DIR) {
		paths.push(
			join(
				process.env.CARGO_MANIFEST_DIR,
				'resources',
				'vendor',
				'bin',
				platformKey,
				binaryName,
			),
		);
	}

	return paths;
}

const extractions = new Map<string, Promise<string | null>>();

export function extractFromVendor(name: string): Promise<string | null> {
	const existing = extractions.get(name);
	if (existing) return existing;
	const pending = extract(name).finally(() => extractions.delete(name));
	extractions.set(name, pending);
	return pending;
}

async function extract(name: string): Promise<string | null> {
	const binaryName = getBinaryFileName(name);
	const binDir = getAgiBinDir();
	const targetPath = join(binDir, binaryName);

	if ((await fileExists(targetPath)) && (await isExecutable(targetPath))) {
		return targetPath;
	}

	const searchPaths = getVendorSearchPaths(binaryName);

	for (const src of searchPaths) {
		if (await fileExists(src)) {
			await ensureDir(binDir);
			const temporary = `${targetPath}.${crypto.randomUUID()}.tmp`;
			try {
				await fs.copyFile(src, temporary);
				await makeExecutable(temporary);
				await fs.rename(temporary, targetPath);
			} finally {
				await fs.rm(temporary, { force: true });
			}
			return targetPath;
		}
	}

	return null;
}
