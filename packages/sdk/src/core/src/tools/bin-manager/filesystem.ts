import { promises as fs } from 'node:fs';

export async function ensureDir(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

export async function isExecutable(p: string): Promise<boolean> {
	try {
		await fs.access(p, 0o1);
		return true;
	} catch {
		return false;
	}
}

export async function makeExecutable(p: string): Promise<void> {
	if (process.platform === 'win32') return;
	try {
		await fs.chmod(p, 0o755);
	} catch {}
}

export { fs };
