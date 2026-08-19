import {
	getProjectConfigDir,
	getProjectConfigPath,
	getProjectStateDir,
	getLegacyProjectDataDir,
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	ensureDir,
	fileExists,
	joinPath,
} from './paths.ts';
import type { OttoConfig } from '../../types/src/index.ts';
import { BUILT_IN_PROVIDER_DESCRIPTORS } from '../../types/src/provider-descriptors.ts';
import {
	readOptionalJsonObject,
	type JsonObject,
} from '../../runtime/json-object-file.ts';

export type { OttoConfig } from '../../types/src/index.ts';

const DEFAULT_PROVIDER_SETTINGS: OttoConfig['providers'] = Object.fromEntries(
	Object.values(BUILT_IN_PROVIDER_DESCRIPTORS).map((descriptor) => [
		descriptor.id,
		{
			enabled: descriptor.defaultEnabled,
			...(descriptor.id === 'ollama-cloud' && descriptor.defaultBaseURL
				? { baseURL: descriptor.defaultBaseURL }
				: {}),
		},
	]),
);

const DEFAULTS: {
	defaults: OttoConfig['defaults'];
	providers: OttoConfig['providers'];
} = {
	defaults: {
		agent: 'build',
		provider: 'ottorouter',
		model: 'kimi-k2.5',
		toolApproval: 'auto',
		guidedMode: false,
		reasoningText: true,
		reasoningLevel: 'high',
		theme: 'otto-dark',
		tuiTheme: 'tokyo-night',
		vimMode: false,
		compactThread: true,
		fontFamily: 'IBM Plex Mono',
		smartEdges: true,
		threadNavigatorRail: true,
		releaseToSend: false,
		fullWidthContent: false,
		dictationKeywords: [],
		dictationExcludedProjectKeywords: [],
		dictationSmartFormatting: true,
		autoCompactThresholdTokens: null,
		coAuthorCommits: false,
	},
	providers: DEFAULT_PROVIDER_SETTINGS,
};

const LOCAL_DEFAULT_OVERRIDE_KEYS = [
	'agent',
	'provider',
	'model',
] satisfies Array<keyof OttoConfig['defaults']>;

export async function loadConfig(
	projectRootInput?: string,
): Promise<OttoConfig> {
	return loadResolvedConfig(projectRootInput, true);
}

/** Loads machine-global configuration without applying project overrides. */
export async function loadGlobalConfig(): Promise<OttoConfig> {
	return loadResolvedConfig(undefined, false);
}

async function loadResolvedConfig(
	projectRootInput: string | undefined,
	includeProjectConfig: boolean,
): Promise<OttoConfig> {
	const projectRoot = projectRootInput
		? String(projectRootInput)
		: process.cwd();

	const projectConfigDir = getProjectConfigDir(projectRoot);
	const projectConfigPath = getProjectConfigPath(projectRoot);
	const projectStateDir = await getProjectStateDir(projectRoot);
	const dataDir = projectStateDir;
	const dbPath = joinPath(projectStateDir, 'otto.sqlite');
	const attachmentsDir = joinPath(projectStateDir, 'attachments');
	const debugDir = joinPath(projectStateDir, 'debug');
	const debugDumpsDir = joinPath(projectStateDir, 'debug-dumps');
	const logsDir = joinPath(projectStateDir, 'logs');
	const tmpDir = joinPath(projectStateDir, 'tmp');
	const cacheDir = joinPath(projectStateDir, 'cache');
	const legacyDbPath = joinPath(
		getLegacyProjectDataDir(projectRoot),
		'otto.sqlite',
	);
	const globalConfigPath = getGlobalConfigPath();
	const globalSkillsConfigPath = getGlobalSkillsConfigPath();

	const projectCfg = includeProjectConfig
		? await readOptionalJsonObject(projectConfigPath)
		: undefined;
	const globalCfg = await readOptionalJsonObject(globalConfigPath);
	const globalSkillsCfg = await readOptionalJsonObject(globalSkillsConfigPath);

	const merged = deepMerge(
		DEFAULTS,
		globalCfg,
		globalSkillsCfg ? { skills: globalSkillsCfg } : undefined,
		filterProjectConfig(projectCfg),
	);

	await ensureDir(projectStateDir);
	if ((await fileExists(legacyDbPath)) && !(await fileExists(dbPath))) {
		console.warn(
			`Legacy Otto database found at ${legacyDbPath}. Run: otto storage migrate`,
		);
	}

	return {
		projectRoot,
		defaults: merged.defaults as OttoConfig['defaults'],
		providers: merged.providers as OttoConfig['providers'],
		skills: merged.skills as OttoConfig['skills'],
		references: merged.references as OttoConfig['references'],
		paths: {
			projectConfigDir,
			projectConfigPath: (await fileExists(projectConfigPath))
				? projectConfigPath
				: null,
			projectStateDir,
			dataDir,
			dbPath,
			attachmentsDir,
			debugDir,
			debugDumpsDir,
			logsDir,
			tmpDir,
			cacheDir,
			globalConfigPath: (await fileExists(globalConfigPath))
				? globalConfigPath
				: null,
		},
	} satisfies OttoConfig;
}

function filterProjectConfig(
	config: JsonObject | undefined,
): JsonObject | undefined {
	if (!config) return undefined;
	const { providers: _providers, skills: _skills, defaults, ...rest } = config;
	const localDefaults = pickLocalDefaults(defaults);
	if (localDefaults) {
		return { ...rest, defaults: localDefaults };
	}
	return rest;
}

function pickLocalDefaults(defaults: unknown): JsonObject | undefined {
	if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
		return undefined;
	}
	const source = defaults as JsonObject;
	const picked: JsonObject = {};
	for (const key of LOCAL_DEFAULT_OVERRIDE_KEYS) {
		if (Object.hasOwn(source, key)) {
			picked[key] = source[key];
		}
	}
	return Object.keys(picked).length > 0 ? picked : undefined;
}

function deepMerge<T extends JsonObject>(
	...objects: Array<JsonObject | undefined>
): T {
	const result: JsonObject = {};
	for (const obj of objects) {
		if (!obj) continue;
		mergeInto(result, obj);
	}
	return result as T;
}

function mergeInto(target: JsonObject, source: JsonObject): JsonObject {
	for (const key of Object.keys(source)) {
		const sv = source[key];
		const tv = target[key];
		if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
			const svObj = sv as JsonObject;
			const nextTarget =
				tv && typeof tv === 'object' && !Array.isArray(tv)
					? (tv as JsonObject)
					: {};
			target[key] = mergeInto(nextTarget, svObj);
		} else {
			target[key] = sv;
		}
	}
	return target;
}

export type { Scope } from './manager.ts';
export {
	read,
	isAuthorized,
	ensureEnv,
	writeDefaults,
	writeProviderSettings,
	removeProviderSettings,
	writeSkillSettings,
	readReferenceSettings,
	writeReferenceSettings,
	removeReferenceSettings,
	writeAuth,
	removeAuth,
} from './manager.ts';
