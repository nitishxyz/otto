import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	getTerminals,
	postTerminals,
	deleteTerminalsById,
	getTerminalsById,
} from '@ottocode/api';

export interface Terminal {
	id: string;
	pid: number;
	command: string;
	args: string[];
	cwd: string;
	purpose: string;
	createdBy: 'user' | 'llm';
	title: string;
	status: 'running' | 'exited';
	exitCode?: number;
	createdAt: string;
	uptime: number;
}

interface TerminalsResponse {
	terminals: Terminal[];
	count: number;
}

interface CreateTerminalParams {
	command: string;
	args?: string[];
	purpose: string;
	cwd?: string;
	title?: string;
}

interface CreateTerminalResponse {
	terminalId: string;
	pid: number;
	purpose: string;
	command: string;
}

interface KillTerminalContext {
	previousTerminals?: TerminalsResponse;
}

export function useTerminals() {
	return useQuery<TerminalsResponse>({
		queryKey: ['terminals'],
		queryFn: async () => {
			const response = await getTerminals();
			if (response.error) {
				throw new Error('Failed to fetch terminals');
			}
			return response.data as TerminalsResponse;
		},
		refetchInterval: 2000,
	});
}

export function useCreateTerminal() {
	const queryClient = useQueryClient();

	return useMutation<CreateTerminalResponse, Error, CreateTerminalParams>({
		mutationFn: async (params) => {
			const response = await postTerminals({
				body: params,
			});

			if (response.error) {
				throw new Error('Failed to create terminal');
			}

			return response.data as CreateTerminalResponse;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['terminals'] });
		},
	});
}

export function useKillTerminal() {
	const queryClient = useQueryClient();

	return useMutation<void, Error, string, KillTerminalContext>({
		mutationFn: async (terminalId) => {
			const response = await deleteTerminalsById({
				path: { id: terminalId },
			});

			if (response.error) {
				throw new Error('Failed to kill terminal');
			}
		},
		onMutate: async (terminalId) => {
			await queryClient.cancelQueries({ queryKey: ['terminals'] });
			const previousTerminals = queryClient.getQueryData<TerminalsResponse>([
				'terminals',
			]);

			if (previousTerminals) {
				const terminals = previousTerminals.terminals.filter(
					(terminal) => terminal.id !== terminalId,
				);
				queryClient.setQueryData<TerminalsResponse>(['terminals'], {
					...previousTerminals,
					terminals,
					count: terminals.length,
				});
			}

			return { previousTerminals };
		},
		onError: (_error, _terminalId, context) => {
			if (context?.previousTerminals) {
				queryClient.setQueryData(['terminals'], context.previousTerminals);
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: ['terminals'] });
		},
	});
}

export function useTerminalOutput(terminalId: string | null) {
	return useQuery<Terminal>({
		queryKey: ['terminal', terminalId],
		queryFn: async () => {
			if (!terminalId) throw new Error('No terminal ID');

			const response = await getTerminalsById({
				path: { id: terminalId },
			});
			if (response.error) {
				throw new Error('Failed to fetch terminal');
			}
			return response.data?.terminal as Terminal;
		},
		enabled: !!terminalId,
		refetchInterval: 1000,
	});
}
