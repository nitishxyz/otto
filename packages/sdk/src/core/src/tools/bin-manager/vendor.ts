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

	const cwd = process.cwd();
	paths.push(join(cwd, 'vendor', 'bin', platformKey, binaryName));

	return paths;
}

export async function extractFromVendor(name: string): Promise<string | null> {
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
			await fs.copyFile(src, targetPath);
			await makeExecutable(targetPath);
			return targetPath;
		}
	}

	return null;
}
