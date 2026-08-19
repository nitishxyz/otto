import { z } from 'zod';

export const dictationErrorCodeSchema = z.enum([
	'DICTATION_SESSION_NOT_FOUND',
	'DICTATION_SESSION_EXPIRED',
	'DICTATION_AUDIO_FORMAT_UNSUPPORTED',
	'DICTATION_AUDIO_TOO_LARGE',
	'DICTATION_INVALID_STATE',
	'DICTATION_TRANSCRIBE_FAILED',
	'DICTATION_ENGINE_MISSING',
	'DICTATION_MODEL_MISSING',
	'DICTATION_MODEL_NOT_FOUND',
	'DICTATION_MODEL_DOWNLOAD_UNAVAILABLE',
	'DICTATION_MODEL_DOWNLOAD_FAILED',
	'DICTATION_MODEL_CHECKSUM_FAILED',
	'DICTATION_MODEL_INSTALL_IN_PROGRESS',
]);

export type DictationErrorCode = z.infer<typeof dictationErrorCodeSchema>;

export const audioFormatSchema = z.object({
	encoding: z.literal('pcm_s16le'),
	sampleRate: z.number().int().positive(),
	channels: z.number().int().positive(),
});

export type AudioEncoding = 'pcm_s16le';
export type AudioFormat = z.infer<typeof audioFormatSchema>;

export const DEFAULT_AUDIO_FORMAT: AudioFormat = Object.freeze({
	encoding: 'pcm_s16le',
	sampleRate: 16_000,
	channels: 1,
});

export const dictationStartMessageSchema = z.object({
	type: z.literal('start'),
	model: z.string().min(1).optional(),
	language: z.string().min(1).optional(),
	prompt: z.string().optional(),
	format: audioFormatSchema.partial().optional(),
	partialResults: z.boolean().optional(),
});

export const dictationStopMessageSchema = z.object({ type: z.literal('stop') });
export const dictationCancelMessageSchema = z.object({
	type: z.literal('cancel'),
});

export const dictationClientMessageSchema = z.discriminatedUnion('type', [
	dictationStartMessageSchema,
	dictationStopMessageSchema,
	dictationCancelMessageSchema,
]);

export type DictationStartMessage = z.infer<typeof dictationStartMessageSchema>;
export type DictationStopMessage = z.infer<typeof dictationStopMessageSchema>;
export type DictationCancelMessage = z.infer<
	typeof dictationCancelMessageSchema
>;
export type DictationClientMessage = z.infer<
	typeof dictationClientMessageSchema
>;

export const dictationReadyEventSchema = z.object({
	type: z.literal('ready'),
	sessionId: z.string().min(1),
	model: z.string().min(1),
	format: audioFormatSchema,
});

export const dictationRecordingEventSchema = z.object({
	type: z.literal('recording'),
	receivedMs: z.number().nonnegative(),
	receivedBytes: z.number().int().nonnegative(),
});

export const dictationFinalEventSchema = z.object({
	type: z.literal('final'),
	text: z.string(),
	language: z.string().min(1),
	model: z.string().min(1),
	durationMs: z.number().nonnegative(),
});

export const dictationErrorEventSchema = z.object({
	type: z.literal('error'),
	code: dictationErrorCodeSchema,
	message: z.string().min(1),
});

export const dictationServerEventSchema = z.discriminatedUnion('type', [
	dictationReadyEventSchema,
	dictationRecordingEventSchema,
	dictationFinalEventSchema,
	dictationErrorEventSchema,
]);

export type DictationReadyEvent = z.infer<typeof dictationReadyEventSchema>;
export type DictationRecordingEvent = z.infer<
	typeof dictationRecordingEventSchema
>;
export type DictationFinalEvent = z.infer<typeof dictationFinalEventSchema>;
export type DictationErrorEvent = z.infer<typeof dictationErrorEventSchema>;
export type DictationServerEvent = z.infer<typeof dictationServerEventSchema>;

export function normalizeAudioFormat(
	format?: Partial<AudioFormat>,
): AudioFormat {
	return audioFormatSchema.parse({ ...DEFAULT_AUDIO_FORMAT, ...format });
}

export function isSupportedAudioFormat(format: AudioFormat): boolean {
	return (
		format.encoding === DEFAULT_AUDIO_FORMAT.encoding &&
		format.sampleRate === DEFAULT_AUDIO_FORMAT.sampleRate &&
		format.channels === DEFAULT_AUDIO_FORMAT.channels
	);
}

export function parseDictationClientMessage(
	raw: string,
): DictationClientMessage {
	return dictationClientMessageSchema.parse(JSON.parse(raw));
}

export function parseDictationServerEvent(raw: string): DictationServerEvent {
	return dictationServerEventSchema.parse(JSON.parse(raw));
}

export function encodeDictationClientMessage(
	message: DictationClientMessage,
): string {
	return JSON.stringify(dictationClientMessageSchema.parse(message));
}

export function encodeDictationServerEvent(
	event: DictationServerEvent,
): string {
	return JSON.stringify(dictationServerEventSchema.parse(event));
}
