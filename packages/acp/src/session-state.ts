import type {
	SessionConfigOption,
	SessionModeState,
} from '@agentclientprotocol/sdk';
import { discoverAllAgents } from '@ottocode/server/runtime/agent-registry';
import {
	getConfiguredProviderIds,
	getConfiguredProviderModels,
	isProviderAuthorized,
	loadConfig,
	modelMapToList,
	type ProviderId,
} from '@ottocode/sdk';
import { toModelId } from './model';
import { DEFAULT_MODE, type AcpSession } from './types';

export async function buildSessionState(session: AcpSession): Promise<{
	configOptions: SessionConfigOption[];
	modes: SessionModeState;
}> {
	const defaults = await loadSessionDefaults(session.cwd);
	session.mode ||= defaults.agent;
	session.provider ||= defaults.provider;
	session.model ||= defaults.model;

	const modelOptions = await buildModelOptions(session);
	const currentModel =
		session.provider && session.model
			? toModelId(session.provider, session.model)
			: modelOptions[0]?.value;
	if (
		currentModel &&
		session.provider &&
		session.model &&
		!modelOptions.some((model) => model.value === currentModel)
	) {
		modelOptions.unshift({
			value: currentModel,
			name: `${session.provider}: ${session.model}`,
			description: 'Configured otto default model',
		});
	}
	const modeOptions = await buildModeOptions(session);

	const configOptions: SessionConfigOption[] = [
		{
			id: 'agent',
			name: 'Agent',
			type: 'select',
			category: 'mode',
			currentValue: session.mode,
			options: modeOptions.map((mode) => ({
				value: mode.id,
				name: mode.name,
				description: mode.description,
			})),
		},
	];

	if (currentModel && modelOptions.length > 0) {
		configOptions.push({
			id: 'model',
			name: 'Model',
			type: 'select',
			category: 'model',
			currentValue: currentModel,
			options: modelOptions,
		});
	}

	return {
		configOptions,
		modes: {
			currentModeId: session.mode,
			availableModes: modeOptions,
		},
	};
}

export async function loadSessionDefaults(cwd: string): Promise<{
	agent: string;
	provider: ProviderId;
	model: string;
}> {
	try {
		const cfg = await loadConfig(cwd);
		return {
			agent: cfg.defaults.agent || DEFAULT_MODE,
			provider: cfg.defaults.provider,
			model: cfg.defaults.model,
		};
	} catch (err) {
		console.error('[acp] Failed to load defaults:', err);
		return { agent: DEFAULT_MODE, provider: '' as ProviderId, model: '' };
	}
}

async function buildModeOptions(
	session: AcpSession,
): Promise<SessionModeState['availableModes']> {
	try {
		const cfg = await loadConfig(session.cwd);
		const agents = await discoverAllAgents(cfg.projectRoot);
		return ensureModeOption(session.mode, agents);
	} catch (err) {
		console.error('[acp] Failed to build agent mode list:', err);
		return ensureModeOption(session.mode, [session.mode || DEFAULT_MODE]);
	}
}

async function buildModelOptions(
	session: AcpSession,
): Promise<Array<{ value: string; name: string; description: string }>> {
	try {
		const cfg = await loadConfig(session.cwd);
		const providers = getConfiguredProviderIds(cfg);
		const options: Array<{
			value: string;
			name: string;
			description: string;
		}> = [];

		for (const provider of providers) {
			if (!(await isProviderAuthorized(cfg, provider))) continue;
			for (const model of modelMapToList(
				getConfiguredProviderModels(cfg, provider),
			)) {
				const modelId = model.id;
				options.push({
					value: toModelId(provider, modelId),
					name: `${provider}: ${model.label ?? modelId}`,
					description: `Use ${modelId} via ${provider}`,
				});
			}
		}

		return options;
	} catch (err) {
		console.error('[acp] Failed to build model list:', err);
		return [];
	}
}

function ensureModeOption(
	modeId: string,
	agentIds: string[],
): SessionModeState['availableModes'] {
	const ids = new Set(agentIds.filter((agentId) => agentId.trim()));
	if (modeId.trim()) ids.add(modeId);
	return Array.from(ids)
		.sort()
		.map((id) => ({
			id,
			name: formatAgentName(id),
			description: `Use the ${id} otto agent`,
		}));
}

function formatAgentName(agentId: string): string {
	return agentId
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}
