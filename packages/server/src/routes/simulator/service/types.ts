export type SimulatorStatus = 'idle' | 'starting' | 'connected' | 'error';

export interface SimulatorState {
	status: SimulatorStatus;
	url: string | null;
	deviceName: string | null;
	udid: string | null;
	port: number;
	error: string | null;
	updatedAt: string;
}

export interface ServeSimCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface ServeSimCommand {
	command: string;
	cwd?: string;
}

export type ParsedServeSimState = {
	url: string;
	deviceName: string | null;
	udid: string | null;
};
