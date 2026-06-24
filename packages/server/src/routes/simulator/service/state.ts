import type { ServeSimCommand, SimulatorState } from './types.ts';

export const DEFAULT_PORT = 3200;

export const simulatorState: SimulatorState = {
	status: 'idle',
	setupStatus: process.platform === 'darwin' ? 'ready' : 'unsupported',
	setupMessage:
		process.platform === 'darwin'
			? null
			: 'serve-sim requires macOS with Xcode command line tools',
	runner: null,
	url: null,
	deviceName: null,
	udid: null,
	port: DEFAULT_PORT,
	error: null,
	updatedAt: new Date().toISOString(),
};

export const simulatorRuntime: {
	previewProcess: ReturnType<typeof Bun.spawn> | null;
	previewStdout: string;
	previewStderr: string;
	cleanupHandlersRegistered: boolean;
	serveSimCommand: ServeSimCommand | null;
	consecutiveProbeFailures: number;
} = {
	previewProcess: null,
	previewStdout: '',
	previewStderr: '',
	cleanupHandlersRegistered: false,
	serveSimCommand: null,
	consecutiveProbeFailures: 0,
};

export function updateState(
	updates: Partial<Omit<SimulatorState, 'updatedAt'>>,
): void {
	Object.assign(simulatorState, updates, {
		updatedAt: new Date().toISOString(),
	});
}

export function getSimulatorStatus(): SimulatorState {
	return { ...simulatorState };
}
