import {
	DEFAULT_AUDIO_FORMAT,
	type AudioFormat,
	type DictationClientMessage,
	type DictationServerEvent,
} from './types.ts';

export function normalizeAudioFormat(
	format?: Partial<AudioFormat>,
): AudioFormat {
	return {
		encoding: format?.encoding ?? DEFAULT_AUDIO_FORMAT.encoding,
		sampleRate: format?.sampleRate ?? DEFAULT_AUDIO_FORMAT.sampleRate,
		channels: format?.channels ?? DEFAULT_AUDIO_FORMAT.channels,
	};
}

export function isSupportedAudioFormat(format: AudioFormat): boolean {
	return (
		format.encoding === 'pcm_s16le' &&
		format.sampleRate === 16000 &&
		format.channels === 1
	);
}

export function parseDictationClientMessage(
	raw: string,
): DictationClientMessage {
	const value = JSON.parse(raw) as Partial<DictationClientMessage>;
	if (
		value.type !== 'start' &&
		value.type !== 'stop' &&
		value.type !== 'cancel'
	) {
		throw new Error('Unsupported dictation message type');
	}
	return value as DictationClientMessage;
}

export function encodeDictationEvent(event: DictationServerEvent): string {
	return JSON.stringify(event);
}
