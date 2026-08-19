import type { AudioFormat } from '@ottocode/sdk/dictation/protocol';

export const DEFAULT_DICTATION_MODEL = 'small.en-q5_1';

export {
	DEFAULT_AUDIO_FORMAT,
	dictationClientMessageSchema,
	dictationErrorCodeSchema,
	dictationServerEventSchema,
} from '@ottocode/sdk/dictation/protocol';
export type {
	AudioEncoding,
	AudioFormat,
	DictationCancelMessage,
	DictationClientMessage,
	DictationErrorCode,
	DictationErrorEvent,
	DictationFinalEvent,
	DictationReadyEvent,
	DictationRecordingEvent,
	DictationServerEvent,
	DictationStartMessage,
	DictationStopMessage,
} from '@ottocode/sdk/dictation/protocol';

export type DictationSessionStatus =
	| 'created'
	| 'recording'
	| 'transcribing'
	| 'completed'
	| 'cancelled'
	| 'error';

export type DictationSession = {
	id: string;
	status: DictationSessionStatus;
	model: string;
	language: string;
	prompt?: string;
	projectRoot?: string;
	format: AudioFormat;
	createdAt: string;
	updatedAt: string;
	receivedBytes: number;
	receivedMs: number;
	pcmPath: string;
	wavPath: string;
	text?: string;
	error?: string;
};

export type DictationModel = {
	id: string;
	label: string;
	language: 'en' | 'multi';
	sizeBytes: number;
	url: string;
	sha256: string;
	recommended?: boolean;
};
