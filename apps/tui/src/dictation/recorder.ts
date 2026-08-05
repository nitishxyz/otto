import { Audio, type AudioCaptureStream } from '@opentui/core';

const SAMPLE_RATE = 16_000;
const CHUNK_FRAMES = 1_600;

export interface MicrophoneRecorderOptions {
	onFrame: (frame: Uint8Array) => void;
	onLevel?: (level: number) => void;
	onError?: (error: Error) => void;
}

export interface MicrophoneRecorder {
	readonly label: string;
	stop(): Promise<void>;
}

/** Starts native OpenTUI microphone capture and emits server-ready PCM frames. */
export async function startMicrophoneRecorder(
	options: MicrophoneRecorderOptions,
): Promise<MicrophoneRecorder> {
	const audio = Audio.create({
		autoStart: false,
		sampleRate: SAMPLE_RATE,
	});
	let capture: AudioCaptureStream;
	try {
		const devices = audio.listCaptureDevices();
		if (devices && devices.length === 0) {
			throw new Error('No microphone input device is available');
		}
		capture = await audio.openCapture({
			channels: 1,
			chunkFrames: CHUNK_FRAMES,
			capacityFrames: SAMPLE_RATE,
		});
	} catch (error) {
		audio.dispose();
		throw normalizeCaptureError(error);
	}

	let stopping = false;
	capture.on('error', (error) => {
		if (!stopping) options.onError?.(normalizeCaptureError(error));
	});

	const pumpPromise = consumeCapture(capture, options).catch(
		(error: unknown) => {
			if (!stopping) options.onError?.(normalizeCaptureError(error));
		},
	);

	return {
		label: 'OpenTUI native capture',
		async stop() {
			if (stopping) return;
			stopping = true;
			capture.stop();
			await pumpPromise;
			await capture.closed;
			audio.dispose();
		},
	};
}

/** Returns a display-ready microphone level using RMS and peak energy. */
export function calculateFloat32Level(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sumSquares = 0;
	let peak = 0;
	for (const sample of samples) {
		const magnitude = Math.abs(sample);
		sumSquares += sample * sample;
		peak = Math.max(peak, magnitude);
	}
	const rms = Math.sqrt(sumSquares / samples.length);
	const combined = rms * 0.72 + peak * 0.28;
	return Math.min(0.95, Math.max(0.03, (combined - 0.004) * 4.8));
}

/** Converts normalized floating-point PCM to signed little-endian PCM16. */
export function float32ToPcm16(samples: Float32Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < samples.length; index++) {
		const sample = Math.max(-1, Math.min(1, samples[index]));
		view.setInt16(
			index * 2,
			sample < 0 ? sample * 0x8000 : sample * 0x7fff,
			true,
		);
	}
	return bytes;
}

async function consumeCapture(
	capture: AudioCaptureStream,
	options: MicrophoneRecorderOptions,
): Promise<void> {
	const reader = capture.readable.getReader();
	try {
		while (true) {
			const { done, value: samples } = await reader.read();
			if (done) break;
			options.onLevel?.(calculateFloat32Level(samples));
			options.onFrame(float32ToPcm16(samples));
		}
	} finally {
		reader.releaseLock();
	}
}

function normalizeCaptureError(error: unknown): Error {
	if (error instanceof Error) {
		if (/permission|denied|not allowed/i.test(error.message)) {
			return new Error(
				'Microphone permission denied. Allow microphone access for this terminal and restart it.',
			);
		}
		return error;
	}
	return new Error('Could not start microphone capture');
}
