import { join } from 'node:path';

const OTTO_BIN_DIR_NAME = 'bin';

let cachedBinDir: string | null = null;

function getConfigHome(): string {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	if (cfgHome?.trim()) return cfgHome.replace(/\\/g, '/');
	const home = process.env.HOME || process.env.USERPROFILE || '';
	return join(home, '.config');
}

export function getAgiBinDir(): string {
	if (cachedBinDir) return cachedBinDir;
	cachedBinDir = join(getConfigHome(), 'otto', OTTO_BIN_DIR_NAME);
	return cachedBinDir;
}

export function getPlatformKey(): string {
	const platform = process.platform;
	const arch = process.arch;
	const os =
		platform === 'darwin'
			? 'darwin'
			: platform === 'win32'
				? 'windows'
				: 'linux';
	const cpu = arch === 'arm64' ? 'arm64' : 'x64';
	return `${os}-${cpu}`;
}

export function getBinaryFileName(name: string): string {
	if (process.platform === 'win32') return `${name}.exe`;
	return name;
}
