import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';

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

function simulatorUrl(path: string) {
	return `${API_BASE_URL.replace(/\/$/, '')}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
	const data = (await response.json()) as T;
	if (!response.ok) {
		const message =
			data && typeof data === 'object' && 'error' in data
				? String((data as { error?: unknown }).error)
				: response.statusText;
		throw new Error(message);
	}
	return data;
}

async function fetchSimulatorStatus(): Promise<SimulatorState> {
	const response = await fetch(simulatorUrl('/v1/simulator/status'));
	return readJson<SimulatorState>(response);
}

async function startSimulator(port = 3200): Promise<SimulatorStartResponse> {
	const response = await fetch(simulatorUrl('/v1/simulator/start'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ port }),
	});
	return readJson<SimulatorStartResponse>(response);
}

async function stopSimulator(): Promise<{ ok: boolean }> {
	const response = await fetch(simulatorUrl('/v1/simulator/stop'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({}),
	});
	return readJson<{ ok: boolean }>(response);
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
