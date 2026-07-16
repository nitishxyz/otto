import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	ListReferenceScope,
	Reference,
	ReferencePreparationEvent,
	ReferenceScope,
	ReferencesResponse,
} from '../lib/api-client/references';
import { getProjectKey } from '../lib/api-client/utils';
import {
	acquireClientEventStream,
	getProjectConnectionState,
	onProjectConnectionState,
} from '../lib/event-stream';

function preparationEventKey(event: ReferencePreparationEvent): string {
	return `${event.name}\0${event.url}\0${event.ref ?? ''}`;
}

function applyPreparationEvent(
	current: ReferencesResponse,
	update: ReferencePreparationEvent,
): ReferencesResponse {
	const reference = current.references[update.name];
	if (
		reference?.source.type !== 'git' ||
		reference.source.url !== update.url ||
		(reference.source.ref ?? '') !== (update.ref ?? '')
	) {
		return current;
	}
	return {
		...current,
		statuses: {
			...current.statuses,
			[update.name]: {
				status: update.status,
				...(update.error ? { error: update.error } : {}),
				...(update.output ? { output: update.output } : {}),
			},
		},
	};
}

export function useReferences(
	scope: ListReferenceScope,
	options: { enabled?: boolean } = {},
) {
	const queryClient = useQueryClient();
	const enabled = options.enabled ?? true;
	const projectKey = getProjectKey();
	const hasConnected = useRef(false);
	const connectionInterrupted = useRef(false);
	const latestPreparationEvents = useRef(
		new Map<string, ReferencePreparationEvent>(),
	);

	useEffect(() => {
		if (!enabled) return;
		void projectKey;
		hasConnected.current = getProjectConnectionState().status === 'connected';
		connectionInterrupted.current = false;
		latestPreparationEvents.current.clear();
		const stream = acquireClientEventStream();
		const offEvent = stream.on((event) => {
			if (event.type !== 'reference.preparation') return;
			const update = event.payload as unknown as ReferencePreparationEvent;
			latestPreparationEvents.current.set(preparationEventKey(update), update);
			queryClient.setQueriesData<ReferencesResponse>(
				{ queryKey: ['references'] },
				(current) =>
					current ? applyPreparationEvent(current, update) : current,
			);
		});
		const offConnectionState = onProjectConnectionState((state) => {
			if (state.status === 'retrying') {
				connectionInterrupted.current = hasConnected.current;
				return;
			}
			if (state.status !== 'connected') return;
			if (connectionInterrupted.current) {
				connectionInterrupted.current = false;
				latestPreparationEvents.current.clear();
				void queryClient.invalidateQueries({ queryKey: ['references'] });
			}
			hasConnected.current = true;
		});

		return () => {
			offEvent();
			offConnectionState();
			stream.release();
		};
	}, [enabled, projectKey, queryClient]);

	return useQuery({
		queryKey: ['references', projectKey, scope],
		queryFn: async () => {
			let response = await apiClient.listReferences(scope);
			for (const update of latestPreparationEvents.current.values()) {
				response = applyPreparationEvent(response, update);
			}
			return response;
		},
		enabled,
	});
}

export function useSaveReference() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			name: string;
			reference: Reference;
			scope: ReferenceScope;
		}) => apiClient.saveReference(input.name, input.reference, input.scope),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['references'] });
		},
	});
}

export function useRetryReference() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => apiClient.retryReference(name),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['references'] });
		},
	});
}

export function useDeleteReference() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { name: string; scope: ReferenceScope }) =>
			apiClient.deleteReference(input.name, input.scope),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['references'] });
		},
	});
}
