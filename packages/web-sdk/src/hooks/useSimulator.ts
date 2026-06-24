import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	getSimulatorStatus,
	startSimulator as apiStartSimulator,
	stopSimulator as apiStopSimulator,
} from '@ottocode/api';

export interface SimulatorState {
	status: 'idle' | 'starting' | 'connected' | 'error';
	setupStatus: 'unsupported' | 'missing_runner' | 'ready' | 'preparing';
	setupMessage: string | null;
	runner: string | null;
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

function getSimulatorApiErrorMessage(error: unknown, fallback: string): string {
	if (error && typeof error === 'object') {
		const record = error as Record<string, unknown>;
		if (typeof record.error === 'string' && record.error.trim()) {
			return record.error;
		}
	}
	return fallback;
}

async function fetchSimulatorStatus(): Promise<SimulatorState> {
	const response = await getSimulatorStatus();
	if (response.error) {
		throw new Error(
			getSimulatorApiErrorMessage(
				response.error,
				'Failed to get simulator status',
			),
		);
	}
	return response.data as SimulatorState;
}

async function startSimulator(port = 3200): Promise<SimulatorStartResponse> {
	const response = await apiStartSimulator({
		body: { port },
	});
	if (response.error) {
		throw new Error(
			getSimulatorApiErrorMessage(response.error, 'Failed to start simulator'),
		);
	}
	return response.data as SimulatorStartResponse;
}

async function stopSimulator(): Promise<{ ok: boolean }> {
	const response = await apiStopSimulator({ body: {} });
	if (response.error) {
		throw new Error(
			getSimulatorApiErrorMessage(response.error, 'Failed to stop simulator'),
		);
	}
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
		onMutate: (port) => {
			const previous = queryClient.getQueryData<SimulatorState>([
				'simulator',
				'status',
			]);
			queryClient.setQueryData<SimulatorState>(['simulator', 'status'], {
				status: 'starting',
				setupStatus:
					previous?.setupStatus === 'ready'
						? 'preparing'
						: (previous?.setupStatus ?? 'preparing'),
				setupMessage: previous?.setupMessage ?? null,
				runner: previous?.runner ?? null,
				url: previous?.url ?? null,
				deviceName: previous?.deviceName ?? null,
				udid: previous?.udid ?? null,
				port: port ?? previous?.port ?? 3200,
				error: null,
				updatedAt: new Date().toISOString(),
			});
		},
		onSuccess: (result) => {
			queryClient.setQueryData<SimulatorState>(['simulator', 'status'], result);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ['simulator'] });
		},
	});
}

export function useStopSimulator() {
	const queryClient = useQueryClient();
	return useMutation<{ ok: boolean }, Error, void>({
		mutationFn: stopSimulator,
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ['simulator'] });
		},
	});
}
