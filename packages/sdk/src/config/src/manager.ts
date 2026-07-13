import { loadConfig } from './index.ts';
import {
	getAllAuth,
	setAuth as setAuthFile,
	removeAuth as removeAuthFile,
	type ProviderId,
	type AuthInfo,
} from '../../auth/src/index.ts';
import type {
	ProviderSettingsEntry,
	ReferenceConfig,
	ReferenceSettings,
	SkillSettings,
} from '../../types/src/index.ts';
import {
	getGlobalConfigDir,
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	getGlobalDebugDir,
	getGlobalDebugLogPath,
	getGlobalDebugSessionsDir,
	getLocalDataDir,
	joinPath,
} from './paths.ts';
import {
	readEnvKey,
	setEnvKey,
	isBuiltInProviderId,
} from '../../providers/src/index.ts';

export type Scope = 'global' | 'local';

const LOCAL_DEFAULT_UPDATE_KEYS = new Set(['agent', 'provider', 'model']);

export type DebugConfig = {
	enabled: boolean;
	scopes: string[];
	logPath: string;
	sessionsDir: string;
	debugDir: string;
};

export async function read(projectRoot?: string) {
	const cfg = await loadConfig(projectRoot);
	const auth = await getAllAuth(projectRoot);
	return { cfg, auth };
}

export async function isAuthorized(
	provider: ProviderId,
	projectRoot?: string,
): Promise<boolean> {
	if (!isBuiltInProviderId(provider)) return false;
	if (readEnvKey(provider)) return true;
	const { auth } = await read(projectRoot);
	const info = auth[provider];
	if (info?.type === 'api' && info.key) return true;
	if (info?.type === 'oauth' && info.refresh && info.access) return true;
	return false;
}

export async function ensureEnv(
	provider: ProviderId,
	projectRoot?: string,
): Promise<void> {
	if (!isBuiltInProviderId(provider)) return;
	if (readEnvKey(provider)) return;
	const { auth } = await read(projectRoot);
	const stored = auth[provider];
	const value = stored?.type === 'api' ? stored.key : undefined;
	if (value) setEnvKey(provider, value);
}

export async function writeDefaults(
	scope: Scope,
	updates: Partial<{
		agent: string;
		provider: ProviderId;
		model: string;
		toolApproval: 'auto' | 'dangerous' | 'all' | 'yolo';
		guidedMode: boolean;
		reasoningText: boolean;
		reasoningLevel: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
		theme: string;
		tuiTheme: string;
		vimMode: boolean;
		compactThread: boolean;
		fontFamily: string;
		smartEdges: boolean;
		threadNavigatorRail: boolean;
		releaseToSend: boolean;
		fullWidthContent: boolean;
		notificationsEnabled: boolean;
		autoCompactThresholdTokens: number | null;
		coAuthorCommits: boolean;
	}>,
	projectRoot?: string,
) {
	const scopedUpdates =
		scope === 'local'
			? (Object.fromEntries(
					Object.entries(updates).filter(([key]) =>
						LOCAL_DEFAULT_UPDATE_KEYS.has(key),
					),
				) as typeof updates)
			: updates;
	if (Object.keys(scopedUpdates).length === 0) return;

	const filePath = getConfigFilePath(scope, projectRoot);
	const existing = await readJsonFile(filePath);
	const prevDefaults =
		existing && typeof existing.defaults === 'object'
			? (existing.defaults as Record<string, unknown>)
			: {};
	const next = {
		...existing,
		defaults: { ...prevDefaults, ...scopedUpdates },
	};
	await writeConfigFile(filePath, next);
}

/**
 * Persist provider settings for a built-in or custom provider entry.
 */
export async function writeProviderSettings(
	_scope: Scope,
	provider: string,
	updates: ProviderSettingsEntry,
	_projectRoot?: string,
) {
	const filePath = getConfigFilePath('global');
	const existing = await readJsonFile(filePath);
	const prevProviders =
		existing && typeof existing.providers === 'object'
			? (existing.providers as Record<string, unknown>)
			: {};
	const previousEntry =
		prevProviders[provider] && typeof prevProviders[provider] === 'object'
			? (prevProviders[provider] as Record<string, unknown>)
			: {};
	const next = {
		...existing,
		providers: {
			...prevProviders,
			[provider]: { ...previousEntry, ...updates },
		},
	};
	await writeConfigFile(filePath, next);
}

/**
 * Remove a provider override or custom provider entry from config.
 */
export async function removeProviderSettings(
	_scope: Scope,
	provider: string,
	_projectRoot?: string,
) {
	const filePath = getConfigFilePath('global');
	const existing = await readJsonFile(filePath);
	if (!existing || typeof existing.providers !== 'object') return;
	const providers = { ...(existing.providers as Record<string, unknown>) };
	delete providers[provider];
	const next = { ...existing, providers };
	await writeConfigFile(filePath, next);
}

export async function writeSkillSettings(
	_scope: Scope,
	updates: SkillSettings,
	_projectRoot?: string,
) {
	const filePath = getGlobalSkillsConfigPath();
	const existing = await readJsonFile(filePath);
	const prevItems =
		existing?.items && typeof existing.items === 'object'
			? (existing.items as Record<string, unknown>)
			: {};
	const next = {
		...existing,
		...updates,
		items: {
			...prevItems,
			...(updates.items ?? {}),
		},
	};
	await writeConfigFile(filePath, next);
}

/** Read references authored directly in one configuration scope. */
export async function readReferenceSettings(
	scope: Scope,
	projectRoot?: string,
): Promise<ReferenceSettings> {
	const config = await readJsonFile(getConfigFilePath(scope, projectRoot));
	if (!config || typeof config.references !== 'object') return {};
	return config.references as ReferenceSettings;
}

/** Persist a named reference in global or project configuration. */
export async function writeReferenceSettings(
	scope: Scope,
	name: string,
	reference: ReferenceConfig,
	projectRoot?: string,
) {
	const filePath = getConfigFilePath(scope, projectRoot);
	const existing = await readJsonFile(filePath);
	const references =
		existing && typeof existing.references === 'object'
			? (existing.references as Record<string, unknown>)
			: {};
	await writeConfigFile(filePath, {
		...existing,
		references: { ...references, [name]: reference },
	});
}

/** Remove a named reference from global or project configuration. */
export async function removeReferenceSettings(
	scope: Scope,
	name: string,
	projectRoot?: string,
) {
	const filePath = getConfigFilePath(scope, projectRoot);
	const existing = await readJsonFile(filePath);
	if (!existing || typeof existing.references !== 'object') return;
	const references = { ...(existing.references as Record<string, unknown>) };
	delete references[name];
	await writeConfigFile(filePath, { ...existing, references });
}

export async function readDebugConfig(
	projectRoot?: string,
): Promise<DebugConfig> {
	const cfg = await loadConfig(projectRoot);
	return {
		enabled: cfg.debugEnabled === true,
		scopes: Array.isArray(cfg.debugScopes)
			? cfg.debugScopes.filter(
					(scope): scope is string =>
						typeof scope === 'string' && scope.trim().length > 0,
				)
			: [],
		logPath: getGlobalDebugLogPath(),
		sessionsDir: getGlobalDebugSessionsDir(),
		debugDir: getGlobalDebugDir(),
	};
}

export async function writeDebugConfig(
	updates: Partial<{
		enabled: boolean;
		scopes: string[];
	}>,
) {
	const globalPath = getGlobalConfigPath();
	const existing = await readJsonFile(globalPath);
	const next: Record<string, unknown> = { ...(existing ?? {}) };

	if (updates.enabled !== undefined) {
		next.debugEnabled = updates.enabled;
	}

	if (updates.scopes !== undefined) {
		next.debugScopes = updates.scopes;
	}

	const base = getGlobalConfigDir();
	try {
		const { promises: fs } = await import('node:fs');
		await fs.mkdir(base, { recursive: true }).catch(() => {});
	} catch {}
	await Bun.write(globalPath, JSON.stringify(next, null, 2));
}

async function readJsonFile(
	filePath: string,
): Promise<Record<string, unknown> | undefined> {
	const f = Bun.file(filePath);
	if (!(await f.exists())) return undefined;
	try {
		const parsed = await f.json();
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function getConfigFilePath(scope: Scope, projectRoot?: string): string {
	const root = projectRoot ? String(projectRoot) : process.cwd();
	if (scope === 'local') {
		const localDir = getLocalDataDir(root);
		return joinPath(localDir, 'config.json');
	}
	return getGlobalConfigPath();
}

async function writeConfigFile(
	filePath: string,
	value: Record<string, unknown>,
) {
	const base =
		filePath === getGlobalConfigPath()
			? getGlobalConfigDir()
			: filePath.slice(0, Math.max(0, filePath.lastIndexOf('/')));
	try {
		const { promises: fs } = await import('node:fs');
		await fs.mkdir(base, { recursive: true }).catch(() => {});
	} catch {}
	await Bun.write(filePath, JSON.stringify(value, null, 2));
}

export async function writeAuth(
	provider: ProviderId,
	info: AuthInfo,
	scope: Scope = 'global',
	projectRoot?: string,
) {
	await setAuthFile(provider, info, projectRoot, scope);
}

export async function removeAuth(
	provider: ProviderId,
	scope: Scope = 'global',
	projectRoot?: string,
) {
	await removeAuthFile(provider, projectRoot, scope);
}

export async function getOnboardingComplete(
	_projectRoot?: string,
): Promise<boolean> {
	const globalPath = getGlobalConfigPath();
	const f = Bun.file(globalPath);
	if (await f.exists()) {
		try {
			const data = await f.json();
			return data?.onboardingComplete === true;
		} catch {
			return false;
		}
	}
	return false;
}

export async function setOnboardingComplete(
	_projectRoot?: string,
): Promise<void> {
	const globalPath = getGlobalConfigPath();
	const base = getGlobalConfigDir();

	let existing: Record<string, unknown> = {};
	const f = Bun.file(globalPath);
	if (await f.exists()) {
		try {
			existing = (await f.json()) as Record<string, unknown>;
		} catch {}
	}

	const next = { ...existing, onboardingComplete: true };

	try {
		const { promises: fs } = await import('node:fs');
		await fs.mkdir(base, { recursive: true }).catch(() => {});
	} catch {}

	await Bun.write(globalPath, JSON.stringify(next, null, 2));
}
