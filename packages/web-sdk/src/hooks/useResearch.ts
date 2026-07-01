import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	createResearchSession as apiCreateResearchSession,
	deleteResearchSession as apiDeleteResearchSession,
	exportResearchSession as apiExportResearchSession,
	injectResearchContext as apiInjectResearchContext,
	listResearchSessions as apiListResearchSessions,
} from '@ottocode/api';
import { getProjectQuery, projectScopedKey } from '../lib/api-client/utils';
import { usePendingResearchStore } from '../stores/pendingResearchStore';
import { getSessionsQueryKey } from './useSessions';

export interface ResearchSession {
	id: string;
	title: string | null;
	createdAt: number;
	lastActiveAt: number | null;
	provider: string;
	model: string;
	messageCount: number;
}

export interface ResearchSessionsResponse {
	sessions: ResearchSession[];
}

export interface CreateResearchResponse {
	session: ResearchSession;
	parentSessionId: string;
}

export interface InjectContextResponse {
	content: string;
	label: string;
	sessionId: string;
	parentSessionId: string;
	tokenEstimate: number;
}

export interface ExportToSessionResponse {
	newSession: {
		id: string;
		title: string | null;
		agent: string;
		provider: string;
		model: string;
	};
	injectedContext: string;
}

class ResearchApiClient {
	async listResearchSessions(
		parentSessionId: string,
	): Promise<ResearchSessionsResponse> {
		const response = await apiListResearchSessions({
			path: { parentId: parentSessionId },
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(JSON.stringify(response.error));
		return response.data as unknown as ResearchSessionsResponse;
	}

	async createResearchSession(
		parentSessionId: string,
		data: { provider?: string; model?: string; title?: string },
	): Promise<CreateResearchResponse> {
		const response = await apiCreateResearchSession({
			path: { parentId: parentSessionId },
			query: getProjectQuery(),
			body: data,
		} as never);
		if (response.error) throw new Error(JSON.stringify(response.error));
		return response.data as unknown as CreateResearchResponse;
	}

	async deleteResearchSession(
		researchId: string,
	): Promise<{ success: boolean }> {
		const response = await apiDeleteResearchSession({
			path: { researchId },
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(JSON.stringify(response.error));
		return response.data as { success: boolean };
	}

	async injectContext(
		parentSessionId: string,
		researchSessionId: string,
		label?: string,
	): Promise<InjectContextResponse> {
		const response = await apiInjectResearchContext({
			path: { parentId: parentSessionId },
			query: getProjectQuery(),
			body: { researchSessionId, label },
		} as never);
		if (response.error) throw new Error(JSON.stringify(response.error));
		return response.data as InjectContextResponse;
	}

	async exportToNewSession(
		researchId: string,
		data?: { provider?: string; model?: string; agent?: string },
	): Promise<ExportToSessionResponse> {
		const response = await apiExportResearchSession({
			path: { researchId },
			query: getProjectQuery(),
			body: data ?? {},
		} as never);
		if (response.error) throw new Error(JSON.stringify(response.error));
		return response.data as ExportToSessionResponse;
	}
}

const researchApi = new ResearchApiClient();

export function useResearchSessions(
	parentSessionId: string | null,
	enabled = true,
) {
	return useQuery({
		queryKey: projectScopedKey([
			'research',
			'sessions',
			parentSessionId,
		] as const),
		queryFn: () => researchApi.listResearchSessions(parentSessionId as string),
		enabled: !!parentSessionId && enabled,
		staleTime: 30000,
	});
}

export function useCreateResearchSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			parentSessionId,
			data,
		}: {
			parentSessionId: string;
			data?: { provider?: string; model?: string; title?: string };
		}) => researchApi.createResearchSession(parentSessionId, data ?? {}),
		onSuccess: (_, { parentSessionId }) => {
			queryClient.invalidateQueries({
				queryKey: projectScopedKey([
					'research',
					'sessions',
					parentSessionId,
				] as const),
			});
		},
	});
}

export function useDeleteResearchSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (researchId: string) =>
			researchApi.deleteResearchSession(researchId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: projectScopedKey(['research', 'sessions'] as const),
			});
		},
	});
}

export function useInjectContext() {
	const addContext = usePendingResearchStore((state) => state.addContext);

	return useMutation({
		mutationFn: ({
			parentSessionId,
			researchSessionId,
			label,
		}: {
			parentSessionId: string;
			researchSessionId: string;
			label?: string;
		}) => researchApi.injectContext(parentSessionId, researchSessionId, label),
		onSuccess: (data, { parentSessionId }) => {
			addContext(parentSessionId, {
				id: data.sessionId,
				sessionId: data.sessionId,
				label: data.label,
				content: data.content,
			});
		},
	});
}

export function useExportToSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			researchId,
			data,
		}: {
			researchId: string;
			data?: { provider?: string; model?: string; agent?: string };
		}) => researchApi.exportToNewSession(researchId, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
		},
	});
}
