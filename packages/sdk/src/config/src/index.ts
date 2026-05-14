import {
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	getLocalDataDir,
	ensureDir,
	fileExists,
	joinPath,
} from './paths.ts';
import type { OttoConfig } from '../../types/src/index.ts';

export type { OttoConfig } from '../../types/src/index.ts';

const DEFAULT_PROVIDER_SETTINGS: OttoConfig['providers'] = {
	openai: { enabled: false },
	anthropic: { enabled: false },
	google: { enabled: false },
	'ollama-cloud': { enabled: false, baseURL: 'https://ollama.com' },
	openrouter: { enabled: false },
	opencode: { enabled: false },
	copilot: { enabled: false },
	ottorouter: { enabled: true },
	xai: { enabled: false },
	zai: { enabled: false },
	'zai-coding': { enabled: false },
	moonshot: { enabled: false },
	minimax: { enabled: false },
};

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
		fullWidthContent: true,
		autoCompactThresholdTokens: null,
	},
	providers: DEFAULT_PROVIDER_SETTINGS,
};

export async function loadConfig(
	projectRootInput?: string,
): Promise<OttoConfig> {
	const projectRoot = projectRootInput
		? String(projectRootInput)
		: process.cwd();

	const dataDir = getLocalDataDir(projectRoot);
	const dbPath = joinPath(dataDir, 'otto.sqlite');
	const projectConfigPath = joinPath(dataDir, 'config.json');
	const globalConfigPath = getGlobalConfigPath();
	const globalSkillsConfigPath = getGlobalSkillsConfigPath();

	const projectCfg = await readJsonOptional(projectConfigPath);
	const globalCfg = await readJsonOptional(globalConfigPath);
	const globalSkillsCfg = await readJsonOptional(globalSkillsConfigPath);

	const merged = deepMerge(
		DEFAULTS,
		globalCfg,
		globalSkillsCfg ? { skills: globalSkillsCfg } : undefined,
		omitGlobalOnlySettings(projectCfg),
	);

	await ensureDir(dataDir);

	return {
		projectRoot,
		defaults: merged.defaults as OttoConfig['defaults'],
		providers: merged.providers as OttoConfig['providers'],
		skills: merged.skills as OttoConfig['skills'],
		paths: {
			dataDir,
			dbPath,
			projectConfigPath: (await fileExists(projectConfigPath))
				? projectConfigPath
				: null,
			globalConfigPath: (await fileExists(globalConfigPath))
				? globalConfigPath
				: null,
		},
	} satisfies OttoConfig;
}

type JsonObject = Record<string, unknown>;

function omitGlobalOnlySettings(
	config: JsonObject | undefined,
): JsonObject | undefined {
	if (!config) return undefined;
	const { providers: _providers, skills: _skills, ...rest } = config;
	return rest;
}

async function readJsonOptional(file: string): Promise<JsonObject | undefined> {
	const f = Bun.file(file);
	if (!(await f.exists())) return undefined;
	try {
		const buf = await f.text();
		const parsed = JSON.parse(buf);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as JsonObject;
		}
		return undefined;
	} catch {
		return undefined;
	}
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
	writeAuth,
	removeAuth,
} from './manager.ts';
