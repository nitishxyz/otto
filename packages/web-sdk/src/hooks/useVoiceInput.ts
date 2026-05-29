import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
	transcript: string;
}

interface SpeechRecognitionResultLike {
	readonly isFinal: boolean;
	readonly length: number;
	[index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
	readonly length: number;
	[index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
	readonly resultIndex: number;
	readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
	readonly error: string;
}

interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start: () => void;
	stop: () => void;
	abort: () => void;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
	onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as {
		SpeechRecognition?: SpeechRecognitionConstructor;
		webkitSpeechRecognition?: SpeechRecognitionConstructor;
	};
	return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface UseVoiceInputOptions {
	/** Called with the cumulative transcript (interim + final) on each update. */
	onTranscript?: (transcript: string, isFinal: boolean) => void;
	onError?: (message: string) => void;
	lang?: string;
}

interface UseVoiceInputResult {
	isListening: boolean;
	isSupported: boolean;
	analyser: AnalyserNode | null;
	error: string | null;
	start: () => Promise<void>;
	stop: () => void;
}

/**
 * Owns the microphone lifecycle for voice input: getUserMedia + AudioContext
 * (for the waveform analyser) and the Web Speech API (for transcription).
 *
 * The returned `analyser` is intended to be passed to <LiveWaveform>.
 */
export function useVoiceInput({
	onTranscript,
	onError,
	lang = 'en-US',
}: UseVoiceInputOptions = {}): UseVoiceInputResult {
	const [isListening, setIsListening] = useState(false);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [error, setError] = useState<string | null>(null);

	const streamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const finalTranscriptRef = useRef('');
	const manualStopRef = useRef(false);

	const onTranscriptRef = useRef(onTranscript);
	const onErrorRef = useRef(onError);
	useEffect(() => {
		onTranscriptRef.current = onTranscript;
		onErrorRef.current = onError;
	}, [onTranscript, onError]);

	const isSupported =
		typeof window !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia &&
		!!getSpeechRecognition();

	const cleanup = useCallback(() => {
		if (recognitionRef.current) {
			recognitionRef.current.onresult = null;
			recognitionRef.current.onerror = null;
			recognitionRef.current.onend = null;
			try {
				recognitionRef.current.abort();
			} catch {
				// ignore
			}
			recognitionRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop();
			streamRef.current = null;
		}
		if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
			audioContextRef.current.close().catch(() => {});
		}
		audioContextRef.current = null;
		setAnalyser(null);
	}, []);

	const stop = useCallback(() => {
		manualStopRef.current = true;
		setIsListening(false);
		cleanup();
	}, [cleanup]);

	const start = useCallback(async () => {
		const SpeechRecognitionCtor = getSpeechRecognition();
		if (!SpeechRecognitionCtor || !navigator.mediaDevices?.getUserMedia) {
			const msg = 'Voice input is not supported in this browser';
			setError(msg);
			onErrorRef.current?.(msg);
			return;
		}

		setError(null);
		manualStopRef.current = false;
		finalTranscriptRef.current = '';

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
			streamRef.current = stream;

			const AudioContextCtor =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext })
					.webkitAudioContext;
			const audioContext = new AudioContextCtor();
			const analyserNode = audioContext.createAnalyser();
			analyserNode.fftSize = 256;
			analyserNode.smoothingTimeConstant = 0.8;
			audioContext.createMediaStreamSource(stream).connect(analyserNode);
			audioContextRef.current = audioContext;
			setAnalyser(analyserNode);

			const recognition = new SpeechRecognitionCtor();
			recognition.continuous = true;
			recognition.interimResults = true;
			recognition.lang = lang;

			recognition.onresult = (event) => {
				let interim = '';
				for (let i = event.resultIndex; i < event.results.length; i++) {
					const result = event.results[i];
					const transcript = result[0]?.transcript ?? '';
					if (result.isFinal) {
						finalTranscriptRef.current += transcript;
					} else {
						interim += transcript;
					}
				}
				const combined = (finalTranscriptRef.current + interim).trim();
				onTranscriptRef.current?.(combined, interim === '');
			};

			recognition.onerror = (event) => {
				if (event.error === 'no-speech' || event.error === 'aborted') return;
				const msg =
					event.error === 'not-allowed'
						? 'Microphone permission denied'
						: `Voice input error: ${event.error}`;
				setError(msg);
				onErrorRef.current?.(msg);
				stop();
			};

			recognition.onend = () => {
				// Auto-restart if it ended unexpectedly while still listening.
				if (!manualStopRef.current && recognitionRef.current) {
					try {
						recognition.start();
						return;
					} catch {
						// fall through to stop
					}
				}
				setIsListening(false);
			};

			recognitionRef.current = recognition;
			recognition.start();
			setIsListening(true);
		} catch (err) {
			const name = err instanceof Error ? err.name : '';
			const msg =
				name === 'NotAllowedError'
					? 'Microphone permission denied'
					: 'Could not start voice input';
			setError(msg);
			onErrorRef.current?.(msg);
			cleanup();
			setIsListening(false);
		}
	}, [lang, stop, cleanup]);

	useEffect(() => cleanup, [cleanup]);

	return { isListening, isSupported, analyser, error, start, stop };
}
