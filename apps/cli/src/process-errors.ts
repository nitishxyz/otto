import { logger } from './cli-deps.ts';

type ProcessError = Error & {
	code?: string;
	syscall?: string;
};

function toProcessError(reason: unknown): ProcessError | null {
	return reason instanceof Error ? (reason as ProcessError) : null;
}

export function isDaemonProcess(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.OTTO_DAEMON_ID);
}

export function isRecoverableDaemonIoError(
	reason: unknown,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (!isDaemonProcess(env)) return false;
	const error = toProcessError(reason);
	if (!error) return false;

	if (error.code === 'EPIPE') {
		return (
			error.syscall === 'send' ||
			error.syscall === 'write' ||
			/broken pipe, (send|write)$/i.test(error.message)
		);
	}

	if (error.code === 'EINTR') {
		return (
			error.syscall === 'read' ||
			error.syscall === 'write' ||
			/interrupted system call, (read|write)$/i.test(error.message)
		);
	}

	return false;
}

function stackMetadata(reason: unknown): Record<string, unknown> | undefined {
	const error = toProcessError(reason);
	return error?.stack ? { stack: error.stack } : undefined;
}

function errorMetadata(error: ProcessError): Record<string, unknown> {
	return {
		name: error.name,
		message: error.message,
		code: error.code,
		syscall: error.syscall,
		stack: error.stack,
	};
}

function handleProcessError(label: string, reason: unknown): void {
	if (isRecoverableDaemonIoError(reason)) {
		const error = toProcessError(reason);
		logger.warn('[daemon] ignored transient process I/O error', {
			label,
			...(error ? { error: errorMetadata(error) } : {}),
		});
		return;
	}

	logger.error(label, reason, stackMetadata(reason));
	process.exit(1);
}

export function installProcessErrorHandlers(): void {
	process.on('unhandledRejection', (reason) => {
		handleProcessError('Unhandled Promise Rejection', reason);
	});

	process.on('uncaughtException', (error) => {
		handleProcessError('Uncaught Exception', error);
	});

	if (isDaemonProcess()) {
		process.on('SIGPIPE', () => {
			logger.warn('[daemon] ignored SIGPIPE from a closed I/O peer');
		});
	}
}
