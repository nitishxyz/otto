import { getAuth, createCopilotModel, readEnvKey } from '@ottocode/sdk';
import type { OttoConfig, OAuth } from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';
const COPILOT_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedCopilotModels = {
	expiresAt: number;
	models: Set<string>;
};

const copilotModelsCache = new Map<string, CachedCopilotModels>();

type CopilotTokenCandidate = {
	source: 'env' | 'oauth';
	token: string;
	oauth: OAuth;
};

async function getCopilotTokenCandidates(
	projectRoot: string,
): Promise<CopilotTokenCandidate[]> {
	const candidates: CopilotTokenCandidate[] = [];

	const envToken = readEnvKey('copilot');
	if (envToken) {
		candidates.push({
			source: 'env',
			token: envToken,
			oauth: {
				type: 'oauth',
				access: envToken,
				refresh: envToken,
				expires: 0,
			},
		});
	}

	const auth = await getAuth('copilot', projectRoot);
	if (auth?.type === 'oauth') {
		if (auth.refresh !== envToken) {
			candidates.push({ source: 'oauth', token: auth.refresh, oauth: auth });
		}
	}

	return candidates;
}

async function getCopilotAvailableModels(
	token: string,
): Promise<Set<string> | null> {
	const cached = copilotModelsCache.get(token);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.models;
	}

	try {
		const response = await providerFetch(COPILOT_MODELS_URL, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Openai-Intent': 'conversation-edits',
				'User-Agent': 'ottocode',
			},
		});

		if (!response.ok) return null;

		const payload = (await response.json()) as {
			data?: Array<{ id?: string }>;
		};
		const models = new Set(
			(payload.data ?? [])
				.map((item) => item.id)
				.filter((id): id is string => Boolean(id)),
		);

		copilotModelsCache.set(token, {
			expiresAt: Date.now() + COPILOT_MODELS_CACHE_TTL_MS,
			models,
		});

		return models;
	} catch {
		return null;
	}
}

export async function resolveCopilotModel(model: string, cfg: OttoConfig) {
	const candidates = await getCopilotTokenCandidates(cfg.projectRoot);
	if (!candidates.length) {
		throw new Error(
			'Copilot provider requires OAuth or GITHUB_TOKEN. Run `otto auth login copilot` or set GITHUB_TOKEN.',
		);
	}

	let selected: CopilotTokenCandidate | null = null;
	const unionAvailableModels = new Set<string>();

	for (const candidate of candidates) {
		const availableModels = await getCopilotAvailableModels(candidate.token);
		if (!availableModels || availableModels.size === 0) continue;

		for (const availableModel of availableModels) {
			unionAvailableModels.add(availableModel);
		}

		if (!selected && availableModels.has(model)) {
			selected = candidate;
		}
	}

	if (selected) {
		return createCopilotModel(model, {
			oauth: selected.oauth,
			fetch: providerFetch,
		});
	}

	if (unionAvailableModels.size > 0) {
		throw new Error(
			`Copilot model '${model}' is not available for this account/organization token. Available models: ${Array.from(unionAvailableModels).join(', ')}`,
		);
	}

	return createCopilotModel(model, {
		oauth: candidates[0].oauth,
		fetch: providerFetch,
	});
}
