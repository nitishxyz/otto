import type { DictationModel } from './types.ts';

const WHISPER_CPP_MODEL_BASE =
	'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const DICTATION_MODELS: DictationModel[] = [
	{
		id: 'tiny.en-q5_1',
		label: 'Fastest English',
		language: 'en',
		sizeBytes: 32_166_155,
		url: `${WHISPER_CPP_MODEL_BASE}/ggml-tiny.en-q5_1.bin`,
		sha256: 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b',
	},
	{
		id: 'base.en-q5_1',
		label: 'Fast English',
		language: 'en',
		sizeBytes: 59_721_011,
		url: `${WHISPER_CPP_MODEL_BASE}/ggml-base.en-q5_1.bin`,
		sha256: '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
	},
	{
		id: 'small.en-q5_1',
		label: 'Balanced English',
		language: 'en',
		sizeBytes: 190_098_681,
		url: `${WHISPER_CPP_MODEL_BASE}/ggml-small.en-q5_1.bin`,
		sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
		recommended: true,
	},
	{
		id: 'large-v3-turbo-q5_0',
		label: 'Accurate Multilingual',
		language: 'multi',
		sizeBytes: 574_041_195,
		url: `${WHISPER_CPP_MODEL_BASE}/ggml-large-v3-turbo-q5_0.bin`,
		sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
	},
];

export function getDictationModel(modelId: string): DictationModel | undefined {
	return DICTATION_MODELS.find((model) => model.id === modelId);
}
