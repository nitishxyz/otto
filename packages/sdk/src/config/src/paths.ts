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

/** Resolve the user-level cross-harness skills directory (~/.agents/skills). */
export function getGlobalAgentsSkillsDir(): string {
	return joinPath(getHomeDir(), '.agents', 'skills');
}

export function getGlobalPluginsConfigPath(): string {
	return joinPath(getGlobalConfigDir(), 'plugins.json');
}

export function getGlobalPluginsDir(): string {
	return joinPath(getGlobalConfigDir(), 'plugins');
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

export function getGlobalCommandsDir(): string {
	return joinPath(getGlobalConfigDir(), 'commands');
}

export function getGlobalRecipesDir(): string {
	return joinPath(getGlobalConfigDir(), 'recipes');
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

/** Resolve the user-level Otto home directory for project state storage. */
export function getOttoHomeDir(): string {
	const ottoHome = process.env.OTTO_HOME;
	if (ottoHome?.trim()) return ottoHome.replace(/\\/g, '/');
	if (process.platform === 'win32') {
		const appData = (process.env.APPDATA || '').replace(/\\/g, '/');
		const base = appData || joinPath(getHomeDir(), 'AppData', 'Roaming');
		return joinPath(base, 'otto');
	}
	return joinPath(getHomeDir(), '.local', 'state', 'otto');
}

/** Resolve the root directory containing per-project state directories. */
export function getProjectsStateRoot(): string {
	return joinPath(getOttoHomeDir(), 'projects');
}

const projectIdCache = new Map<string, Promise<string>>();

/** Build a stable readable project ID from basename and canonical path hash. */
export async function getProjectId(projectRoot: string): Promise<string> {
	const normalizedProjectRoot = projectRoot.replace(/\\/g, '/');
	const cached = projectIdCache.get(normalizedProjectRoot);
	if (cached) return cached;

	const projectId = resolveProjectId(normalizedProjectRoot);
	projectIdCache.set(normalizedProjectRoot, projectId);
	return projectId;
}

async function resolveProjectId(
	normalizedProjectRoot: string,
): Promise<string> {
	const slug = sanitizeProjectSlug(getPathBasename(normalizedProjectRoot));
	const hashInput = await getCanonicalProjectRoot(normalizedProjectRoot);
	const hash = (await sha256Hex(hashInput)).slice(0, 8);
	return `${slug}-${hash}`;
}

/** Resolve the repository-local Otto project config directory. */
export function getProjectConfigDir(projectRoot: string): string {
	return joinPath(projectRoot, '.otto');
}

/** Resolve the repository-local Otto project config file path. */
export function getProjectConfigPath(projectRoot: string): string {
	return joinPath(getProjectConfigDir(projectRoot), 'config.json');
}

/** Resolve the repository-local Otto project plugins config file path. */
export function getProjectPluginsConfigPath(projectRoot: string): string {
	return joinPath(getProjectConfigDir(projectRoot), 'plugins.json');
}

/** Resolve the repository-local Otto project plugins directory. */
export function getProjectPluginsDir(projectRoot: string): string {
	return joinPath(getProjectConfigDir(projectRoot), 'plugins');
}

/** Resolve the repository-local cross-harness skills directory (.agents/skills). */
export function getProjectAgentsSkillsDir(projectRoot: string): string {
	return joinPath(projectRoot, '.agents', 'skills');
}

/** Resolve the user-level state directory for a project. */
export async function getProjectStateDir(projectRoot: string): Promise<string> {
	return joinPath(getProjectsStateRoot(), await getProjectId(projectRoot));
}

/** Resolve the project SQLite database path under user-level state. */
export async function getProjectDbPath(projectRoot: string): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'otto.sqlite');
}

/** Resolve the project attachments directory under user-level state. */
export async function getProjectAttachmentsDir(
	projectRoot: string,
): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'attachments');
}

/** Resolve the project debug directory under user-level state. */
export async function getProjectDebugDir(projectRoot: string): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'debug');
}

/** Resolve the project debug dumps directory under user-level state. */
export async function getProjectDebugDumpsDir(
	projectRoot: string,
): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'debug-dumps');
}

/** Resolve the project logs directory under user-level state. */
export async function getProjectLogsDir(projectRoot: string): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'logs');
}

/** Resolve the project temporary files directory under user-level state. */
export async function getProjectTmpDir(projectRoot: string): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'tmp');
}

/** Resolve the project cache directory under user-level state. */
export async function getProjectCacheDir(projectRoot: string): Promise<string> {
	return joinPath(await getProjectStateDir(projectRoot), 'cache');
}

/** Resolve the legacy repository-local data directory used before migration. */
export function getLegacyProjectDataDir(projectRoot: string): string {
	return joinPath(projectRoot, '.otto');
}

/** @deprecated Use getLegacyProjectDataDir() for legacy project-local data. */
export function getLocalDataDir(projectRoot: string): string {
	return getLegacyProjectDataDir(projectRoot);
}

function sanitizeProjectSlug(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project';
}

function getPathBasename(path: string): string {
	const trimmed = path.replace(/\/+$/g, '');
	const index = trimmed.lastIndexOf('/');
	return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

async function sha256Hex(input: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (subtle) {
		const encoded = new TextEncoder().encode(input);
		const digest = await subtle.digest('SHA-256', encoded);
		return Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, '0'),
		).join('');
	}

	const { createHash } = await loadCrypto();
	return createHash('sha256').update(input).digest('hex');
}

async function getCanonicalProjectRoot(projectRoot: string): Promise<string> {
	try {
		const { realpath } = await loadFsPromises();
		return (await realpath(projectRoot)).replace(/\\/g, '/');
	} catch {
		return projectRoot.replace(/\\/g, '/');
	}
}

async function loadFsPromises(): Promise<typeof import('node:fs/promises')> {
	return Function('specifier', 'return import(specifier)')('node:fs/promises');
}

async function loadCrypto(): Promise<typeof import('node:crypto')> {
	return Function('specifier', 'return import(specifier)')('node:crypto');
}

export async function ensureDir(dir: string) {
	const { mkdir } = await loadFsPromises();
	await mkdir(dir, { recursive: true }).catch(() => {});
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
