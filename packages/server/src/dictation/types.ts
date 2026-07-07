export const DEFAULT_DICTATION_MODEL = 'small.en-q5_1';

export type DictationErrorCode =
	| 'DICTATION_SESSION_NOT_FOUND'
	| 'DICTATION_SESSION_EXPIRED'
	| 'DICTATION_AUDIO_FORMAT_UNSUPPORTED'
	| 'DICTATION_AUDIO_TOO_LARGE'
	| 'DICTATION_INVALID_STATE'
	| 'DICTATION_TRANSCRIBE_FAILED'
	| 'DICTATION_ENGINE_MISSING'
	| 'DICTATION_MODEL_MISSING'
	| 'DICTATION_MODEL_NOT_FOUND'
	| 'DICTATION_MODEL_DOWNLOAD_UNAVAILABLE'
	| 'DICTATION_MODEL_DOWNLOAD_FAILED'
	| 'DICTATION_MODEL_CHECKSUM_FAILED'
	| 'DICTATION_MODEL_INSTALL_IN_PROGRESS';

export type AudioEncoding = 'pcm_s16le';

export type AudioFormat = {
	encoding: AudioEncoding;
	sampleRate: number;
	channels: number;
};

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

export type DictationStartMessage = {
	type: 'start';
	model?: string;
	language?: string;
	prompt?: string;
	format?: Partial<AudioFormat>;
	partialResults?: boolean;
};

export type DictationStopMessage = {
	type: 'stop';
};

export type DictationCancelMessage = {
	type: 'cancel';
};

export type DictationClientMessage =
	| DictationStartMessage
	| DictationStopMessage
	| DictationCancelMessage;

export type DictationServerEvent =
	| {
			type: 'ready';
			sessionId: string;
			model: string;
			format: AudioFormat;
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
			code: DictationErrorCode;
			message: string;
	  };

export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
	encoding: 'pcm_s16le',
	sampleRate: 16000,
	channels: 1,
};
