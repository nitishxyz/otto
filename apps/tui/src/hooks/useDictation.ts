import {
	connectDictationSession,
	createDictationSession,
	getDictationStatus,
	type DictationConnection,
} from '@ottocode/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseUrl } from '../api.ts';
import {
	startMicrophoneRecorder,
	type MicrophoneRecorder,
} from '../dictation/recorder.ts';
import { appendDictationTranscript } from '../lib/dictation-text.ts';

export type DictationPhase =
	| 'idle'
	| 'checking'
	| 'connecting'
	| 'recording'
	| 'transcribing';

interface UseDictationOptions {
	getDraft: () => string;
	setDraft: (text: string) => void;
	submit: (text: string) => void;
	releaseToSend?: boolean;
	onNeedsInstall: (onReady: () => void) => void;
	onError: (message: string) => void;
}

interface StartOptions {
	skipModelCheck?: boolean;
	preserveBaseText?: boolean;
}

export function useDictation(options: UseDictationOptions) {
	const [phase, setPhase] = useState<DictationPhase>('idle');
	const [level, setLevel] = useState(0);
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const connectionRef = useRef<DictationConnection | null>(null);
	const recorderRef = useRef<MicrophoneRecorder | null>(null);
	const baseTextRef = useRef('');
	const operationRef = useRef(0);
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const reset = useCallback(() => {
		connectionRef.current = null;
		recorderRef.current = null;
		setPhase('idle');
		setLevel(0);
		setStartedAt(null);
	}, []);

	const cancel = useCallback(async () => {
		operationRef.current++;
		const recorder = recorderRef.current;
		const connection = connectionRef.current;
		recorderRef.current = null;
		connectionRef.current = null;
		connection?.cancel();
		await recorder?.stop().catch(() => undefined);
		reset();
	}, [reset]);

	const fail = useCallback(
		async (error: unknown) => {
			const message =
				error instanceof Error ? error.message : 'Could not start dictation';
			await cancel();
			optionsRef.current.onError(message);
		},
		[cancel],
	);

	const start = useCallback(
		async (startOptions: StartOptions = {}) => {
			if (connectionRef.current || recorderRef.current || phase !== 'idle') {
				return;
			}
			const operation = ++operationRef.current;
			if (!startOptions.preserveBaseText) {
				baseTextRef.current = optionsRef.current.getDraft();
			}

			try {
				setPhase('checking');
				const statusResponse = await getDictationStatus();
				if (statusResponse.error || !statusResponse.data) {
					throw new Error(
						toApiError(statusResponse.error, 'Dictation unavailable'),
					);
				}
				if (operation !== operationRef.current) return;

				const status = statusResponse.data;
				const model =
					status.models.find((item) => item.id === status.defaultModel) ??
					status.models.find((item) => item.recommended) ??
					status.models[0];
				if (!model) throw new Error('No dictation models are available');

				if (!startOptions.skipModelCheck && !model.installed) {
					setPhase('idle');
					optionsRef.current.onNeedsInstall(() => {
						void start({
							skipModelCheck: true,
							preserveBaseText: true,
						});
					});
					return;
				}

				if (!model.installed) {
					throw new Error('Dictation model installation did not complete');
				}

				setPhase('connecting');
				const sessionResponse = await createDictationSession({
					body: { model: model.id, language: 'en' },
				});
				if (sessionResponse.error || !sessionResponse.data) {
					throw new Error(
						toApiError(
							sessionResponse.error,
							'Could not create dictation session',
						),
					);
				}
				if (!sessionResponse.data.modelInstalled) {
					throw new Error('Install a local dictation model before recording');
				}

				const connection = await connectDictationSession({
					session: sessionResponse.data,
					baseUrl: getBaseUrl(),
					language: 'en',
					onEvent: (event) => {
						if (event.type === 'error') void fail(new Error(event.message));
					},
				});
				if (operation !== operationRef.current) {
					connection.cancel();
					return;
				}
				connectionRef.current = connection;

				const recorder = await startMicrophoneRecorder({
					onFrame: (frame) => connection.sendAudio(frame),
					onLevel: setLevel,
					onError: (error) => void fail(error),
				});
				if (operation !== operationRef.current) {
					await recorder.stop();
					connection.cancel();
					return;
				}
				recorderRef.current = recorder;
				setStartedAt(Date.now());
				setPhase('recording');
			} catch (error) {
				if (operation === operationRef.current) await fail(error);
			}
		},
		[fail, phase],
	);

	const stop = useCallback(async () => {
		if (phase !== 'recording') return;
		const operation = operationRef.current;
		const recorder = recorderRef.current;
		const connection = connectionRef.current;
		if (!recorder || !connection) return;
		setPhase('transcribing');
		try {
			await recorder.stop();
			recorderRef.current = null;
			const final = await connection.stop();
			if (operation !== operationRef.current) return;
			const text = appendDictationTranscript(
				baseTextRef.current,
				final.text.trim(),
			);
			if (optionsRef.current.releaseToSend && text.trim()) {
				optionsRef.current.submit(text);
			} else {
				optionsRef.current.setDraft(text);
			}
			connection.close();
			reset();
		} catch (error) {
			if (operation === operationRef.current) await fail(error);
		}
	}, [fail, phase, reset]);

	const toggle = useCallback(() => {
		if (phase === 'recording') {
			void stop();
			return;
		}
		if (phase === 'idle') void start();
	}, [phase, start, stop]);

	useEffect(() => {
		return () => {
			operationRef.current++;
			connectionRef.current?.cancel();
			void recorderRef.current?.stop();
		};
	}, []);

	return {
		phase,
		level,
		startedAt,
		isActive: phase !== 'idle',
		start,
		stop,
		cancel,
		toggle,
	};
}

function toApiError(error: unknown, fallback: string): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object') {
		const value = error as { error?: unknown; message?: unknown };
		if (typeof value.error === 'string') return value.error;
		if (typeof value.message === 'string') return value.message;
	}
	return fallback;
}
