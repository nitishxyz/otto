import {
	getDictationStatus as apiGetDictationStatus,
	installDictationModel as apiInstallDictationModel,
	listDictationModels as apiListDictationModels,
	removeDictationModel as apiRemoveDictationModel,
	createDictationSession as apiCreateDictationSession,
} from '@ottocode/api';
import { extractErrorMessage, getBaseUrl } from './utils';

export type DictationModelInstallStatus =
	| 'idle'
	| 'installing'
	| 'verifying'
	| 'installed'
	| 'error';

export interface DictationModelState {
	id: string;
	label: string;
	language: 'en' | 'multi';
	sizeBytes: number;
	url: string;
	sha256: string;
	recommended?: boolean;
	installed: boolean;
	installing: boolean;
	installedSizeBytes: number;
	installStatus: DictationModelInstallStatus;
	progressBytes: number;
	totalBytes: number;
	error?: string;
	errorCode?: string;
}

export interface DictationStatusResponse {
	available: boolean;
	engine: string;
	engineInstalled: boolean;
	defaultModel: string;
	format?: {
		encoding?: string;
		sampleRate?: number;
		channels?: number;
	};
	models: DictationModelState[];
}

export interface DictationModelsResponse {
	models: DictationModelState[];
}

export interface InstallDictationModelInput {
	model: string;
	force?: boolean;
}

export interface InstallDictationModelResponse {
	model: DictationModelState;
}

export interface RemoveDictationModelResponse {
	removed: boolean;
	model: DictationModelState;
}

export interface DictationModelInstallEvent {
	type: 'model';
	model: DictationModelState;
}

export interface CreateDictationSessionInput {
	model?: string;
	language?: string;
	prompt?: string;
}

export interface CreateDictationSessionResponse {
	id: string;
	wsUrl: string;
	model: string;
	modelInstalled: boolean;
	format: {
		encoding: string;
		sampleRate: number;
		channels: number;
	};
}

function coerceModelState(value: unknown): DictationModelState {
	return value as DictationModelState;
}

function coerceModels(value: unknown): DictationModelState[] {
	return Array.isArray(value) ? value.map(coerceModelState) : [];
}

function buildInstallEventsUrl(model: string): string {
	const baseUrl = getBaseUrl().replace(/\/+$/, '');
	return `${baseUrl}/v1/dictation/models/${encodeURIComponent(model)}/install/events`;
}

export const dictationMixin = {
	async getDictationStatus(): Promise<DictationStatusResponse> {
		const response = await apiGetDictationStatus();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		const data = response.data as Omit<DictationStatusResponse, 'models'> & {
			models?: unknown;
		};
		return {
			...data,
			models: coerceModels(data.models),
		};
	},

	async listDictationModels(): Promise<DictationModelsResponse> {
		const response = await apiListDictationModels();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		const data = response.data as { models?: unknown };
		return { models: coerceModels(data.models) };
	},

	async installDictationModel({
		model,
		force,
	}: InstallDictationModelInput): Promise<InstallDictationModelResponse> {
		const response = await apiInstallDictationModel({
			path: { model },
			body: { force },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		const data = response.data as { model: unknown };
		return { model: coerceModelState(data.model) };
	},

	async removeDictationModel(
		model: string,
	): Promise<RemoveDictationModelResponse> {
		const response = await apiRemoveDictationModel({ path: { model } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		const data = response.data as { removed: boolean; model: unknown };
		return {
			removed: data.removed,
			model: coerceModelState(data.model),
		};
	},

	async createDictationSession(
		input: CreateDictationSessionInput = {},
	): Promise<CreateDictationSessionResponse> {
		const response = await apiCreateDictationSession({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as CreateDictationSessionResponse;
	},

	getDictationModelInstallEventsUrl: buildInstallEventsUrl,
};
