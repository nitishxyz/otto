export type SimulatorStatus = 'idle' | 'starting' | 'connected' | 'error';

export type ServeSimSetupStatus =
	| 'unsupported'
	| 'missing_runner'
	| 'ready'
	| 'preparing';

export interface SimulatorState {
	status: SimulatorStatus;
	setupStatus: ServeSimSetupStatus;
	setupMessage: string | null;
	runner: string | null;
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
	argsPrefix: string[];
	cwd?: string;
	runner: string;
}

export type ParsedServeSimState = {
	url: string;
	deviceName: string | null;
	udid: string | null;
};
