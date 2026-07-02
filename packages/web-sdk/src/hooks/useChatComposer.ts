import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentDetails } from './useAgents';
import { useAllModels, useConfig } from './useConfig';
import { useSession, useUpdateSession } from './useSessions';
import type { UpdateSessionRequest } from '../types/api';

export interface UseChatComposerOptions {
	/** When set, composer state hydrates from the session and persists changes to it. */
	sessionId?: string;
	/** Initial agent override for the new-session (no sessionId) case. */
	defaultAgent?: string;
}

/**
 * Shared controller state for the chat input composer.
 *
 * Owns agent/provider/model selection for both the existing-session input
 * (hydrates from the session row, persists via session PATCH) and the
 * new-session input (hydrates from config defaults + agent overrides,
 * local-only until the session is created).
 */
export function useChatComposer({
	sessionId,
	defaultAgent,
}: UseChatComposerOptions = {}) {
	const { data: config } = useConfig();
	const { data: allModels } = useAllModels();
	const { data: agentDetails } = useAgentDetails({ enabled: true });
	const session = useSession(sessionId ?? '');
	const updateSession = useUpdateSession(sessionId ?? '');

	const [agent, setAgent] = useState('');
	const [provider, setProvider] = useState('');
	const [model, setModel] = useState('');
	const initializedRef = useRef(false);
	const lastNonPlanAgentRef = useRef(defaultAgent || 'build');

	useEffect(() => {
		if (!sessionId || !session) return;
		setAgent(session.agent);
		setProvider(session.provider);
		setModel(session.model);
		if (session.agent !== 'plan') {
			lastNonPlanAgentRef.current = session.agent;
		}
	}, [sessionId, session]);

	useEffect(() => {
		if (sessionId || initializedRef.current) return;
		if (!config?.defaults || !agentDetails?.agents.length) return;
		initializedRef.current = true;
		const initialAgent = defaultAgent || config.defaults.agent || 'general';
		const selectedAgent = agentDetails.agents.find(
			(agentDetail) => agentDetail.name === initialAgent,
		);
		setAgent(initialAgent);
		if (initialAgent !== 'plan') {
			lastNonPlanAgentRef.current = initialAgent;
		}
		setProvider(selectedAgent?.provider ?? config.defaults.provider ?? '');
		setModel(selectedAgent?.model ?? config.defaults.model ?? '');
	}, [sessionId, agentDetails?.agents, config, defaultAgent]);

	const agentNames = useMemo(
		() =>
			(agentDetails?.agents.length
				? agentDetails.agents.map((agentDetail) => agentDetail.name)
				: (config?.agents ?? [])
			).filter((name) => name !== 'looper'),
		[agentDetails?.agents, config?.agents],
	);

	const selectedModel = useMemo(
		() => allModels?.[provider]?.models?.find((m) => m.id === model),
		[allModels, provider, model],
	);

	const persist = useCallback(
		async (update: UpdateSessionRequest) => {
			if (!sessionId) return;
			try {
				await updateSession.mutateAsync(update);
			} catch (error) {
				console.error('Failed to update session:', error);
			}
		},
		[sessionId, updateSession],
	);

	const handleAgentChange = useCallback(
		async (value: string) => {
			setAgent(value);
			if (value !== 'plan') {
				lastNonPlanAgentRef.current = value;
			}
			const selectedAgent = agentDetails?.agents.find(
				(agentDetail) => agentDetail.name === value,
			);
			if (!selectedAgent) {
				await persist({ agent: value });
				return;
			}
			const nextProvider =
				selectedAgent.provider ?? config?.defaults?.provider ?? provider;
			const nextModel = selectedAgent.model ?? config?.defaults?.model ?? model;
			setProvider(nextProvider);
			setModel(nextModel);
			await persist({
				agent: value,
				provider: nextProvider,
				model: nextModel,
			});
		},
		[
			agentDetails?.agents,
			config?.defaults?.model,
			config?.defaults?.provider,
			model,
			provider,
			persist,
		],
	);

	const handlePlanModeToggle = useCallback(
		async (isPlanMode: boolean) => {
			await handleAgentChange(
				isPlanMode ? 'plan' : lastNonPlanAgentRef.current || 'build',
			);
		},
		[handleAgentChange],
	);

	const handleModelSelectorChange = useCallback(
		async (newProvider: string, newModel: string) => {
			setProvider(newProvider);
			setModel(newModel);
			await persist({ provider: newProvider, model: newModel });
		},
		[persist],
	);

	const handleProviderChange = useCallback(
		async (newProvider: string) => {
			setProvider(newProvider);
			if (model) {
				await persist({ provider: newProvider, model });
			}
		},
		[model, persist],
	);

	const handleModelChange = useCallback(
		async (newModel: string) => {
			setModel(newModel);
			await persist({ provider, model: newModel });
		},
		[provider, persist],
	);

	return {
		config,
		allModels,
		agent,
		provider,
		model,
		agentNames,
		isPlanMode: agent === 'plan',
		modelSupportsReasoning: selectedModel?.reasoningText,
		modelSupportsVision: selectedModel?.vision,
		modelSupportsAttachment: selectedModel?.attachment,
		modelIsFree: selectedModel?.free,
		providerAuthType: allModels?.[provider]?.authType,
		isCustomProvider:
			allModels?.[provider]?.label?.includes('(custom)') ?? false,
		handleAgentChange,
		handlePlanModeToggle,
		handleProviderChange,
		handleModelChange,
		handleModelSelectorChange,
	};
}
