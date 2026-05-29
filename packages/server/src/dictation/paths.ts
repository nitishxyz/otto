import { join } from 'node:path';
import { getGlobalConfigDir } from '@ottocode/sdk';

export function getDictationDir(): string {
	return join(getGlobalConfigDir(), 'dictation');
}

export function getDictationModelsDir(): string {
	return join(getDictationDir(), 'models');
}

export function getDictationModelPath(modelId: string): string {
	return join(getDictationModelsDir(), `${modelId}.bin`);
}

export function getDictationModelDownloadPath(modelId: string): string {
	return join(getDictationModelsDir(), `${modelId}.download`);
}

export function getDictationTempDir(): string {
	return join(getDictationDir(), 'tmp');
}

export function getDictationSessionPcmPath(sessionId: string): string {
	return join(getDictationTempDir(), `${sessionId}.pcm`);
}

export function getDictationSessionWavPath(sessionId: string): string {
	return join(getDictationTempDir(), `${sessionId}.wav`);
}
