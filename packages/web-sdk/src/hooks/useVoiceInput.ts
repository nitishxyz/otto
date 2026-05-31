import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/api-client';

const TARGET_SAMPLE_RATE = 16000;
const PCM_FRAME_BYTES = 3200; // 100ms of 16 kHz mono pcm_s16le

type DictationServerEvent =
	| {
			type: 'ready';
			sessionId: string;
			model: string;
	  }
	| {
			type: 'recording';
			receivedMs: number;
			receivedBytes: number;
	  }
	| {
			type: 'final';
			text: string;
			language: string;
			model: string;
			durationMs: number;
	  }
	| {
			type: 'error';
			code: string;
			message: string;
	  };

interface UseVoiceInputOptions {
	/** Called when local dictation returns transcript text. */
	onTranscript?: (transcript: string, isFinal: boolean) => void;
	onError?: (message: string) => void;
	onNeedsInstall?: () => void;
	lang?: string;
}

interface UseVoiceInputResult {
	isListening: boolean;
	isTranscribing: boolean;
	isSupported: boolean;
	analyser: AnalyserNode | null;
	error: string | null;
	start: () => Promise<void>;
	stop: () => void;
}

type ScriptProcessorNodeLike = ScriptProcessorNode & {
	onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
};

function getAudioContextConstructor(): typeof AudioContext | null {
	if (typeof window === 'undefined') return null;
	return (
		window.AudioContext ||
		(window as unknown as { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext ||
		null
	);
}

function toLanguageCode(lang: string): string {
	return lang.split('-', 1)[0]?.toLowerCase() || 'en';
}

function parseServerEvent(raw: string): DictationServerEvent | null {
	try {
		const value = JSON.parse(raw) as DictationServerEvent;
		if (!value || typeof value.type !== 'string') return null;
		return value;
	} catch {
		return null;
	}
}

function resampleLinear(
	input: Float32Array,
	inputSampleRate: number,
	outputSampleRate: number,
): Float32Array {
	if (inputSampleRate === outputSampleRate) return input;
	const ratio = inputSampleRate / outputSampleRate;
	const outputLength = Math.max(1, Math.floor(input.length / ratio));
	const output = new Float32Array(outputLength);
	for (let i = 0; i < outputLength; i++) {
		const inputIndex = i * ratio;
		const before = Math.floor(inputIndex);
		const after = Math.min(before + 1, input.length - 1);
		const weight = inputIndex - before;
		output[i] = input[before] * (1 - weight) + input[after] * weight;
	}
	return output;
}

function floatToPcm16(samples: Float32Array): ArrayBuffer {
	const buffer = new ArrayBuffer(samples.length * 2);
	const view = new DataView(buffer);
	for (let i = 0; i < samples.length; i++) {
		const sample = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
	}
	return buffer;
}

function appendBuffer(
	a: Uint8Array<ArrayBufferLike>,
	b: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
	const next = new Uint8Array(a.byteLength + b.byteLength);
	next.set(a, 0);
	next.set(b, a.byteLength);
	return next;
}

/**
 * Owns local streaming dictation: getUserMedia + AudioContext for waveform and
 * PCM frame capture, plus a WebSocket session to the local otto server.
 *
 * The returned `analyser` is intended to be passed to <LiveWaveform>.
 */
export function useVoiceInput({
	onTranscript,
	onError,
	onNeedsInstall,
	lang = 'en-US',
}: UseVoiceInputOptions = {}): UseVoiceInputResult {
	const [isListening, setIsListening] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [error, setError] = useState<string | null>(null);

	const streamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const processorRef = useRef<ScriptProcessorNodeLike | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const frameBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array(0));
	const stoppingRef = useRef(false);
	const sessionIdRef = useRef<string | null>(null);

	const onTranscriptRef = useRef(onTranscript);
	const onErrorRef = useRef(onError);
	const onNeedsInstallRef = useRef(onNeedsInstall);
	useEffect(() => {
		onTranscriptRef.current = onTranscript;
		onErrorRef.current = onError;
		onNeedsInstallRef.current = onNeedsInstall;
	}, [onTranscript, onError, onNeedsInstall]);

	const isSupported =
		typeof window !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia &&
		!!getAudioContextConstructor() &&
		typeof WebSocket !== 'undefined';

	const emitError = useCallback((message: string) => {
		setError(message);
		onErrorRef.current?.(message);
	}, []);

	const handleMissingModel = useCallback(() => {
		if (onNeedsInstallRef.current) {
			onNeedsInstallRef.current();
			return;
		}
		emitError(
			'Install a local dictation model from Settings before recording.',
		);
	}, [emitError]);

	const cleanupAudio = useCallback(() => {
		if (processorRef.current) {
			processorRef.current.onaudioprocess = null;
			processorRef.current.disconnect();
			processorRef.current = null;
		}
		if (sourceRef.current) {
			sourceRef.current.disconnect();
			sourceRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop();
			streamRef.current = null;
		}
		if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
			audioContextRef.current.close().catch(() => {});
		}
		audioContextRef.current = null;
		frameBufferRef.current = new Uint8Array(0);
		setAnalyser(null);
	}, []);

	const cleanup = useCallback(() => {
		cleanupAudio();
		if (socketRef.current) {
			const socket = socketRef.current;
			socket.onopen = null;
			socket.onmessage = null;
			socket.onerror = null;
			socket.onclose = null;
			if (socket.readyState === WebSocket.OPEN) {
				socket.close(1000, 'Dictation cleanup');
			}
			socketRef.current = null;
		}
		sessionIdRef.current = null;
		stoppingRef.current = false;
		setIsListening(false);
		setIsTranscribing(false);
	}, [cleanupAudio]);

	const flushFrameBuffer = useCallback((force = false) => {
		const socket = socketRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		let buffer = frameBufferRef.current;
		while (buffer.byteLength >= PCM_FRAME_BYTES) {
			const frame = buffer.slice(0, PCM_FRAME_BYTES);
			socket.send(frame);
			buffer = buffer.slice(PCM_FRAME_BYTES);
		}
		if (force && buffer.byteLength > 0) {
			socket.send(buffer);
			buffer = new Uint8Array(0);
		}
		frameBufferRef.current = buffer;
	}, []);

	const handleAudioProcess = useCallback(
		(event: AudioProcessingEvent) => {
			const audioContext = audioContextRef.current;
			const socket = socketRef.current;
			if (
				!audioContext ||
				!socket ||
				socket.readyState !== WebSocket.OPEN ||
				stoppingRef.current
			) {
				return;
			}
			const input = event.inputBuffer.getChannelData(0);
			const resampled = resampleLinear(
				input,
				audioContext.sampleRate,
				TARGET_SAMPLE_RATE,
			);
			frameBufferRef.current = appendBuffer(
				frameBufferRef.current,
				new Uint8Array(floatToPcm16(resampled)),
			);
			flushFrameBuffer(false);
		},
		[flushFrameBuffer],
	);

	const stop = useCallback(() => {
		stoppingRef.current = true;
		flushFrameBuffer(true);
		cleanupAudio();
		const socket = socketRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			setIsListening(false);
			setIsTranscribing(true);
			socket.send(JSON.stringify({ type: 'stop' }));
		} else {
			setIsListening(false);
			setIsTranscribing(false);
		}
	}, [cleanupAudio, flushFrameBuffer]);

	const start = useCallback(async () => {
		if (!isSupported) {
			emitError('Voice input is not supported in this browser');
			return;
		}

		cleanup();
		setError(null);
		setIsTranscribing(false);
		stoppingRef.current = false;

		try {
			const status = await apiClient.getDictationStatus();
			const model = status.models.find(
				(item) => item.id === status.defaultModel,
			);
			if (!model?.installed) {
				handleMissingModel();
				return;
			}

			const session = await apiClient.createDictationSession({
				model: status.defaultModel,
				language: toLanguageCode(lang),
			});
			if (!session.modelInstalled) {
				handleMissingModel();
				return;
			}

			const socket = new WebSocket(session.wsUrl);
			socket.binaryType = 'arraybuffer';
			socketRef.current = socket;
			sessionIdRef.current = session.id;

			await new Promise<void>((resolve, reject) => {
				const timeout = window.setTimeout(() => {
					reject(new Error('Timed out connecting to local dictation'));
				}, 5000);

				socket.onopen = () => {
					window.clearTimeout(timeout);
					socket.send(
						JSON.stringify({
							type: 'start',
							model: session.model,
							language: toLanguageCode(lang),
							format: {
								encoding: 'pcm_s16le',
								sampleRate: TARGET_SAMPLE_RATE,
								channels: 1,
							},
							partialResults: false,
						}),
					);
					resolve();
				};

				socket.onerror = () => {
					window.clearTimeout(timeout);
					reject(new Error('Could not connect to local dictation'));
				};
			});

			socket.onmessage = (event) => {
				if (typeof event.data !== 'string') return;
				const payload = parseServerEvent(event.data);
				if (!payload) return;
				if (payload.type === 'final') {
					onTranscriptRef.current?.(payload.text.trim(), true);
					cleanup();
					return;
				}
				if (payload.type === 'error') {
					emitError(payload.message);
					cleanup();
				}
			};

			socket.onclose = () => {
				if (!stoppingRef.current) setIsListening(false);
				setIsTranscribing(false);
			};

			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
			streamRef.current = stream;

			const AudioContextCtor = getAudioContextConstructor();
			if (!AudioContextCtor) throw new Error('AudioContext is unavailable');
			const audioContext = new AudioContextCtor();
			const source = audioContext.createMediaStreamSource(stream);
			const analyserNode = audioContext.createAnalyser();
			analyserNode.fftSize = 256;
			analyserNode.smoothingTimeConstant = 0.55;

			const processor = audioContext.createScriptProcessor(
				4096,
				1,
				1,
			) as ScriptProcessorNodeLike;
			processor.onaudioprocess = handleAudioProcess;
			source.connect(analyserNode);
			source.connect(processor);
			processor.connect(audioContext.destination);

			audioContextRef.current = audioContext;
			sourceRef.current = source;
			processorRef.current = processor;
			setAnalyser(analyserNode);
			setIsListening(true);
		} catch (err) {
			const name = err instanceof Error ? err.name : '';
			const msg =
				name === 'NotAllowedError'
					? 'Microphone permission denied'
					: err instanceof Error
						? err.message
						: 'Could not start voice input';
			emitError(msg);
			cleanup();
		}
	}, [
		cleanup,
		emitError,
		handleAudioProcess,
		handleMissingModel,
		isSupported,
		lang,
	]);

	useEffect(() => cleanup, [cleanup]);

	return {
		isListening,
		isTranscribing,
		isSupported,
		analyser,
		error,
		start,
		stop,
	};
}
