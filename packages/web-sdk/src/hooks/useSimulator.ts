import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	getSimulatorStatus,
	startSimulator as apiStartSimulator,
	stopSimulator as apiStopSimulator,
} from '@ottocode/api';

export interface SimulatorState {
	status: 'idle' | 'starting' | 'connected' | 'error';
	url: string | null;
	deviceName: string | null;
	udid: string | null;
	port: number;
	error: string | null;
	updatedAt: string;
}

interface SimulatorStartResponse extends SimulatorState {
	ok: boolean;
	stdout?: string;
}

async function fetchSimulatorStatus(): Promise<SimulatorState> {
	const response = await getSimulatorStatus();
	if (response.error) throw new Error('Failed to get simulator status');
	return response.data as SimulatorState;
}

async function startSimulator(port = 3200): Promise<SimulatorStartResponse> {
	const response = await apiStartSimulator({
		body: { port },
	});
	if (response.error) throw new Error('Failed to start simulator');
	return response.data as SimulatorStartResponse;
}

async function stopSimulator(): Promise<{ ok: boolean }> {
	const response = await apiStopSimulator({ body: {} });
	if (response.error) throw new Error('Failed to stop simulator');
	return response.data as { ok: boolean };
}

export function useSimulatorStatus() {
	return useQuery<SimulatorState>({
		queryKey: ['simulator', 'status'],
		queryFn: fetchSimulatorStatus,
		refetchInterval: 3000,
	});
}

export function useStartSimulator() {
	const queryClient = useQueryClient();
	return useMutation<SimulatorStartResponse, Error, number | undefined>({
		mutationFn: (port) => startSimulator(port),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['simulator'] });
		},
	});
}

export function useStopSimulator() {
	const queryClient = useQueryClient();
	return useMutation<{ ok: boolean }, Error, void>({
		mutationFn: stopSimulator,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['simulator'] });
		},
	});
}
