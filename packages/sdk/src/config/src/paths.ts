// Utilities for resolving otto config/data paths consistently
// Uses XDG base directory spec for global config: ~/.config/otto by default

// Minimal path join to avoid node:path; ensures forward slashes
function joinPath(...parts: string[]) {
	return parts
		.filter(Boolean)
		.map((p) => p.replace(/\\/g, '/'))
		.join('/')
		.replace(/\/+\/+/g, '/');
}

export function getHomeDir(): string {
	return (process.env.HOME || process.env.USERPROFILE || '').replace(
		/\\/g,
		'/',
	);
}

export function getConfigHomeDir(): string {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	if (cfgHome?.trim()) return cfgHome.replace(/\\/g, '/');
	return joinPath(getHomeDir(), '.config');
}

export function getGlobalConfigDir(): string {
	return joinPath(getConfigHomeDir(), 'otto');
}

export function getGlobalConfigPath(): string {
	return joinPath(getGlobalConfigDir(), 'config.json');
}

export function getGlobalSkillsConfigPath(): string {
	return joinPath(getGlobalConfigDir(), 'skills.json');
}

export function getGlobalAuthPath(): string {
	return joinPath(getGlobalConfigDir(), 'auth.json');
}

export function getSecureBaseDir(): string {
	const platform = process.platform;
	if (platform === 'darwin') {
		return joinPath(getHomeDir(), 'Library', 'Application Support', 'otto');
	}
	if (platform === 'win32') {
		const appData = (process.env.APPDATA || '').replace(/\\/g, '/');
		const base = appData || joinPath(getHomeDir(), 'AppData', 'Roaming');
		return joinPath(base, 'otto');
	}
	const stateHome = (process.env.XDG_STATE_HOME || '').replace(/\\/g, '/');
	const base = stateHome || joinPath(getHomeDir(), '.local', 'state');
	return joinPath(base, 'otto');
}

export function getSecureOAuthDir(): string {
	return joinPath(getSecureBaseDir(), 'oauth');
}

// Secure location for auth secrets (not in config dir or project)
// - Linux: $XDG_STATE_HOME/otto/auth.json or ~/.local/state/otto/auth.json
// - macOS: ~/Library/Application Support/otto/auth.json
// - Windows: %APPDATA%\otto\auth.json
export function getSecureAuthPath(): string {
	return joinPath(getSecureBaseDir(), 'auth.json');
}

// Global content under config dir
export function getGlobalAgentsJsonPath(): string {
	return joinPath(getGlobalConfigDir(), 'agents.json');
}

export function getGlobalAgentsDir(): string {
	return joinPath(getGlobalConfigDir(), 'agents');
}

export function getGlobalToolsDir(): string {
	return joinPath(getGlobalConfigDir(), 'tools');
}

export function getGlobalCommandsDir(): string {
	return joinPath(getGlobalConfigDir(), 'commands');
}

export function getGlobalDebugDir(): string {
	return joinPath(getGlobalConfigDir(), 'debug');
}

export function getGlobalDebugLogPath(): string {
	return joinPath(getGlobalDebugDir(), 'latest.log');
}

export function getGlobalDebugSessionsDir(): string {
	return joinPath(getGlobalDebugDir(), 'sessions');
}

export function getSessionDebugLogPath(sessionId: string): string {
	return joinPath(getGlobalDebugSessionsDir(), `${sessionId}.log`);
}

export function getSessionDebugDetailsLogPath(sessionId: string): string {
	return joinPath(getGlobalDebugSessionsDir(), `${sessionId}.details.log`);
}

export function getSessionSystemPromptPath(sessionId: string): string {
	return joinPath(
		getGlobalDebugSessionsDir(),
		`${sessionId}.system-prompt.txt`,
	);
}

export function getLocalDataDir(projectRoot: string): string {
	return joinPath(projectRoot, '.otto');
}

async function loadFsPromises(): Promise<typeof import('node:fs/promises')> {
	return Function('specifier', 'return import(specifier)')('node:fs/promises');
}

export async function ensureDir(dir: string) {
	const { mkdir, writeFile } = await loadFsPromises();
	await mkdir(dir, { recursive: true }).catch(() => {});
	await writeFile(joinPath(dir, '.keep'), '').catch(() => {});
}

export async function fileExists(p: string) {
	try {
		const { access } = await loadFsPromises();
		await access(p);
		return true;
	} catch {
		return false;
	}
}

export { joinPath };
