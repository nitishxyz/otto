import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { getProjectKey } from '../lib/api-client/utils';
import type {
	DictationModelInstallEvent,
	DictationModelState,
	DictationStatusResponse,
} from '../lib/api-client';

function mergeModelState(
	current: DictationStatusResponse | undefined,
	model: DictationModelState,
): DictationStatusResponse | undefined {
	if (!current) return current;
	return {
		...current,
		models: current.models.map((item) => (item.id === model.id ? model : item)),
	};
}

function parseInstallEvent(raw: string): DictationModelInstallEvent | null {
	try {
		const value = JSON.parse(raw) as Partial<DictationModelInstallEvent>;
		if (value.type !== 'model' || !value.model) return null;
		return value as DictationModelInstallEvent;
	} catch {
		return null;
	}
}

export function useDictationModels() {
	const queryClient = useQueryClient();
	const projectKey = getProjectKey();
	const statusQueryKey = useMemo(
		() => ['project', projectKey, 'dictation', 'status'] as const,
		[projectKey],
	);
	const eventSourceRef = useRef<EventSource | null>(null);
	const [activeInstallModelId, setActiveInstallModelId] = useState<
		string | null
	>(null);
	const [installProgress, setInstallProgress] =
		useState<DictationModelState | null>(null);
	const [installStreamError, setInstallStreamError] = useState<string | null>(
		null,
	);

	const statusQuery = useQuery({
		queryKey: statusQueryKey,
		queryFn: () => apiClient.getDictationStatus(),
		refetchInterval: (query) =>
			query.state.data?.models.some((model) => model.installing) ? 1000 : 30000,
	});

	const closeInstallStream = useCallback(() => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
			eventSourceRef.current = null;
		}
	}, []);

	const openInstallStream = useCallback(
		(modelId: string) => {
			if (typeof EventSource === 'undefined') return;
			closeInstallStream();
			setActiveInstallModelId(modelId);
			setInstallStreamError(null);

			const eventSource = new EventSource(
				apiClient.getDictationModelInstallEventsUrl(modelId),
			);
			eventSourceRef.current = eventSource;

			eventSource.onmessage = (event) => {
				const payload = parseInstallEvent(event.data);
				if (!payload) return;
				setInstallProgress(payload.model);
				queryClient.setQueryData<DictationStatusResponse | undefined>(
					statusQueryKey,
					(current) => mergeModelState(current, payload.model),
				);
				if (!payload.model.installing) {
					closeInstallStream();
					setActiveInstallModelId(null);
					void queryClient.invalidateQueries({
						queryKey: statusQueryKey,
					});
				}
			};

			eventSource.onerror = () => {
				setInstallStreamError('Lost dictation model install progress stream');
				closeInstallStream();
				setActiveInstallModelId(null);
				void queryClient.invalidateQueries({
					queryKey: statusQueryKey,
				});
			};
		},
		[closeInstallStream, queryClient, statusQueryKey],
	);

	useEffect(() => closeInstallStream, [closeInstallStream]);

	const installMutation = useMutation({
		mutationFn: (input: { model: string; force?: boolean }) =>
			apiClient.installDictationModel(input),
		onSuccess: (data) => {
			setInstallProgress(data.model);
			queryClient.setQueryData<DictationStatusResponse | undefined>(
				statusQueryKey,
				(current) => mergeModelState(current, data.model),
			);
			if (data.model.installing) {
				openInstallStream(data.model.id);
			} else {
				closeInstallStream();
				setActiveInstallModelId(null);
				void queryClient.invalidateQueries({
					queryKey: statusQueryKey,
				});
			}
		},
	});

	const removeMutation = useMutation({
		mutationFn: (model: string) => apiClient.removeDictationModel(model),
		onSuccess: (data) => {
			queryClient.setQueryData<DictationStatusResponse | undefined>(
				statusQueryKey,
				(current) => mergeModelState(current, data.model),
			);
			void queryClient.invalidateQueries({
				queryKey: statusQueryKey,
			});
		},
	});

	const installModel = useCallback(
		(model: string, options: { force?: boolean } = {}) =>
			installMutation.mutateAsync({ model, force: options.force }),
		[installMutation],
	);

	const removeModel = useCallback(
		(model: string) => removeMutation.mutateAsync(model),
		[removeMutation],
	);

	return {
		statusQuery,
		status: statusQuery.data,
		models: statusQuery.data?.models ?? [],
		defaultModel: statusQuery.data?.defaultModel ?? null,
		isAvailable: statusQuery.data?.available ?? false,
		activeInstallModelId,
		installProgress,
		installStreamError,
		installModel,
		removeModel,
		installMutation,
		removeMutation,
		openInstallStream,
		closeInstallStream,
	};
}
