import { describe, expect, test } from 'bun:test';
import {
	isDaemonProcess,
	isRecoverableDaemonIoError,
} from '../apps/cli/src/process-errors.ts';

function systemError(
	message: string,
	code: string,
	syscall?: string,
): Error & { code: string; syscall?: string } {
	return Object.assign(new Error(message), { code, syscall });
}

describe('daemon process errors', () => {
	test('detects daemon child processes', () => {
		expect(isDaemonProcess({ OTTO_DAEMON_ID: 'daemon-id' })).toBe(true);
		expect(isDaemonProcess({})).toBe(false);
	});

	test('treats closed-pipe send errors as daemon-recoverable', () => {
		const error = systemError('EPIPE: broken pipe, send', 'EPIPE', 'send');

		expect(
			isRecoverableDaemonIoError(error, { OTTO_DAEMON_ID: 'daemon-id' }),
		).toBe(true);
		expect(isRecoverableDaemonIoError(error, {})).toBe(false);
	});

	test('treats interrupted daemon reads as recoverable', () => {
		const error = systemError(
			'EINTR: interrupted system call, read',
			'EINTR',
			'read',
		);

		expect(
			isRecoverableDaemonIoError(error, { OTTO_DAEMON_ID: 'daemon-id' }),
		).toBe(true);
	});

	test('keeps unrelated daemon exceptions fatal', () => {
		expect(
			isRecoverableDaemonIoError(new Error('boom'), {
				OTTO_DAEMON_ID: 'daemon-id',
			}),
		).toBe(false);
		expect(
			isRecoverableDaemonIoError(
				systemError('EPIPE: broken pipe, connect', 'EPIPE', 'connect'),
				{ OTTO_DAEMON_ID: 'daemon-id' },
			),
		).toBe(false);
	});
});
