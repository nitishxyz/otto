import fg from 'fast-glob';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';

const pluginPatterns = ['tools/*/tool.js', 'tools/*/tool.mjs'];

export type PluginFileCandidate = {
	folder: string;
	absPath: string;
};

export async function discoverPluginFiles(
	base: string | null | undefined,
): Promise<PluginFileCandidate[]> {
	if (!base) return [];
	try {
		await fs.readdir(base);
	} catch {
		return [];
	}

	const candidates = new Map<string, PluginFileCandidate>();
	for (const candidate of await discoverPluginFilesWithGlob(base)) {
		candidates.set(`${candidate.folder}:${candidate.absPath}`, candidate);
	}
	for (const candidate of await discoverPluginFilesByDirectoryScan(base)) {
		candidates.set(`${candidate.folder}:${candidate.absPath}`, candidate);
	}
	return Array.from(candidates.values());
}

async function discoverPluginFilesWithGlob(
	base: string,
): Promise<PluginFileCandidate[]> {
	const candidates: PluginFileCandidate[] = [];
	for (const pattern of pluginPatterns) {
		const files = await fg(pattern, { cwd: base, absolute: false });
		for (const rel of files) {
			const match = rel.match(/^tools\/([^/]+)\/tool\.(m?js)$/);
			if (!match || !match[1]) continue;
			candidates.push({
				folder: match[1],
				absPath: join(base, rel).replace(/\\/g, '/'),
			});
		}
	}
	return candidates;
}

async function discoverPluginFilesByDirectoryScan(
	base: string,
): Promise<PluginFileCandidate[]> {
	try {
		const toolsDir = join(base, 'tools');
		const entries = await fs.readdir(toolsDir).catch(() => [] as string[]);
		const candidates: PluginFileCandidate[] = [];
		for (const folder of entries) {
			const candidate = await findToolFile(toolsDir, folder);
			if (!candidate) continue;
			candidates.push({
				folder,
				absPath: candidate.replace(/\\/g, '/'),
			});
		}
		return candidates;
	} catch {
		return [];
	}
}

async function findToolFile(
	toolsDir: string,
	folder: string,
): Promise<string | null> {
	const js = join(toolsDir, folder, 'tool.js');
	const mjs = join(toolsDir, folder, 'tool.mjs');
	return fs
		.stat(js)
		.then(() => js)
		.catch(async () =>
			fs
				.stat(mjs)
				.then(() => mjs)
				.catch(() => null),
		);
}
