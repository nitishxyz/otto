import {
	hasConfiguredProvider,
	validateProviderModel,
	type ProviderId,
} from '@ottocode/sdk';
import { userInfo } from 'node:os';
import { resolveAgentConfig } from '../../../runtime/agent/registry.ts';
import type { ProjectDbContext, SessionRow } from './types.ts';

export type SessionPreferenceUpdates = {
	agent?: string;
	provider?: string;
	model?: string;
	title?: string | null;
	lastActiveAt?: number;
	pinnedAt?: number | null;
};

export async function buildSessionPreferenceUpdates(
	cfg: ProjectDbContext['cfg'],
	existingSession: SessionRow,
	body: Record<string, unknown>,
): Promise<
	| { ok: true; updates: SessionPreferenceUpdates }
	| { ok: false; error: string; status: 400 }
> {
	const updates: SessionPreferenceUpdates = {};
	let shouldTouchLastActiveAt = false;

	if (typeof body.title === 'string') {
		updates.title = body.title.trim() || null;
		shouldTouchLastActiveAt = true;
	}

	if (typeof body.isPinned === 'boolean') {
		updates.pinnedAt = body.isPinned
			? (existingSession.pinnedAt ?? Date.now())
			: null;
	}

	if (typeof body.agent === 'string') {
		const agentName = body.agent.trim();
		if (agentName) {
			try {
				const agentCfg = await resolveAgentConfig(cfg.projectRoot, agentName);
				updates.agent = agentName;
				if (
					typeof body.provider !== 'string' &&
					typeof body.model !== 'string'
				) {
					const agentProvider = hasConfiguredProvider(cfg, agentCfg.provider)
						? agentCfg.provider
						: cfg.defaults.provider;
					const agentModel = agentCfg.model ?? cfg.defaults.model;
					validateProviderModel(agentProvider, agentModel, cfg);
					updates.provider = agentProvider;
					updates.model = agentModel;
				}
				shouldTouchLastActiveAt = true;
			} catch {
				return { ok: false, error: `Invalid agent: ${agentName}`, status: 400 };
			}
		}
	}

	if (typeof body.provider === 'string') {
		const providerName = body.provider.trim();
		if (providerName && hasConfiguredProvider(cfg, providerName)) {
			updates.provider = providerName;
			shouldTouchLastActiveAt = true;
		} else if (providerName) {
			return {
				ok: false,
				error: `Invalid provider: ${providerName}`,
				status: 400,
			};
		}
	}

	if (typeof body.model === 'string') {
		const modelName = body.model.trim();
		if (modelName) {
			const targetProvider = (updates.provider ||
				existingSession.provider) as ProviderId;
			const allowUnknownModel = body.allowUnknownModel === true;
			try {
				validateProviderModel(targetProvider, modelName, cfg, {
					allowUnknownModel,
				});
			} catch {
				return {
					ok: false,
					error: `Model "${modelName}" not found for provider "${targetProvider}"`,
					status: 400,
				};
			}

			updates.model = modelName;
			shouldTouchLastActiveAt = true;
		}
	}

	if (shouldTouchLastActiveAt) {
		updates.lastActiveAt = Date.now();
	}

	return { ok: true, updates };
}

export function getUsername(): string {
	try {
		return userInfo().username;
	} catch {
		return 'anonymous';
	}
}
