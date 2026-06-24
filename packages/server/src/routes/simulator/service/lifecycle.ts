import {
	findServeSimCommand,
	getServeSimAvailability,
	runServeSim,
} from './command.ts';
import {
	DEFAULT_PORT,
	getSimulatorStatus,
	simulatorRuntime,
	simulatorState,
	updateState,
} from './state.ts';
import {
	cleanupPreviewProcess,
	detectRunningPreview,
	isMacOS,
	isPreviewUrlReady,
	killProcessOnPort,
	markPreviewConnected,
	previewUrlForPort,
	registerCleanupHandlers,
	startPreviewProcess,
	waitForPreviewUrl,
} from './preview.ts';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';

export async function startSimulator(
	options: { port?: number; device?: string; openPanel?: boolean } = {},
) {
	if (!isMacOS()) {
		const error = 'serve-sim requires macOS with Xcode command line tools';
		updateState({
			status: 'error',
			setupStatus: 'unsupported',
			setupMessage: error,
			runner: null,
			error: error,
		});
		return { ok: false, ...getSimulatorStatus() };
	}

	const port = options.port ?? DEFAULT_PORT;
	const availability = getServeSimAvailability();
	updateState({
		status: 'starting',
		setupStatus:
			availability.setupStatus === 'ready'
				? 'preparing'
				: availability.setupStatus,
		setupMessage: availability.setupMessage,
		runner: availability.runner,
		error: null,
		port,
	});
	try {
		findServeSimCommand();
	} catch (error) {
		const message = toErrorMessage(error);
		updateState({
			status: 'error',
			setupStatus: 'missing_runner',
			setupMessage: message,
			runner: null,
			error: message,
		});
		return { ok: false, ...getSimulatorStatus(), error: message };
	}
	const runningPreview = await detectRunningPreview(port);
	if (runningPreview) {
		markPreviewConnected(runningPreview, port);
		return {
			ok: true,
			...getSimulatorStatus(),
			stdout: simulatorRuntime.previewStdout,
		};
	}

	if (simulatorRuntime.previewProcess) {
		const parsed = await waitForPreviewUrl(port, 1_000);
		if (parsed) {
			markPreviewConnected(parsed, port);
			return {
				ok: true,
				...getSimulatorStatus(),
				stdout: simulatorRuntime.previewStdout,
			};
		}
		cleanupPreviewProcess();
		await killProcessOnPort(port);
	}

	await killProcessOnPort(port);
	registerCleanupHandlers();

	const args = ['--port', String(port)];
	if (options.device) args.push(options.device);

	updateState({ setupStatus: 'ready', setupMessage: null });
	startPreviewProcess(args);
	// Allow extra time for a cold `bun x`/`npx serve-sim@latest` download on the
	// first run. Readiness is judged by the preview URL, not the process handle,
	// because the foreground runner may re-exec/exit while serve-sim stays up.
	const parsed = await waitForPreviewUrl(port, 60_000);
	if (!parsed) {
		const error =
			simulatorRuntime.previewStderr ||
			simulatorRuntime.previewStdout ||
			'Timed out waiting for serve-sim';
		cleanupPreviewProcess();
		await killProcessOnPort(port);
		updateState({ status: 'error', error });
		return {
			ok: false,
			error,
			stdout: simulatorRuntime.previewStdout,
			stderr: simulatorRuntime.previewStderr,
		};
	}
	markPreviewConnected(parsed, port);

	return {
		ok: true,
		...getSimulatorStatus(),
		stdout: simulatorRuntime.previewStdout,
	};
}

export async function listSimulators() {
	const result = await runServeSim(['--list', '--quiet']).catch((error) => ({
		exitCode: 1,
		stdout: '',
		stderr: toErrorMessage(error),
	}));
	if (result.exitCode !== 0) {
		return {
			ok: false,
			error:
				result.stderr || result.stdout || 'Failed to list serve-sim streams',
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}
	const parsed = await detectRunningPreview(simulatorState.port);
	if (
		parsed &&
		(await isPreviewUrlReady(previewUrlForPort(simulatorState.port)))
	) {
		markPreviewConnected(parsed, simulatorState.port);
	} else if (simulatorState.status === 'connected') {
		updateState({
			status: 'idle',
			url: null,
			deviceName: null,
			udid: null,
			error: null,
		});
	}
	return { ok: true, state: getSimulatorStatus(), raw: result.stdout };
}

export async function stopSimulator(device?: string) {
	const port = simulatorState.port;
	cleanupPreviewProcess();
	const args = ['--kill', '--quiet'];
	if (device) args.push(device);
	const result = await runServeSim(args).catch((error) => ({
		exitCode: 1,
		stdout: '',
		stderr: toErrorMessage(error),
	}));
	if (result.exitCode !== 0) {
		const error = result.stderr || result.stdout || 'Failed to stop serve-sim';
		updateState({ status: 'error', error });
		return { ok: false, error, stdout: result.stdout, stderr: result.stderr };
	}
	await killProcessOnPort(port);
	updateState({
		status: 'idle',
		url: null,
		deviceName: null,
		udid: null,
		error: null,
	});
	return { ok: true, ...getSimulatorStatus(), stdout: result.stdout };
}
