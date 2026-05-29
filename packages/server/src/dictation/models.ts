import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { getDictationModel } from './manifest.ts';
import {
	getDictationModelDownloadPath,
	getDictationModelPath,
	getDictationModelsDir,
} from './paths.ts';
import type { DictationErrorCode, DictationModel } from './types.ts';

export type DictationModelInstallStatus =
	| 'idle'
	| 'installing'
	| 'verifying'
	| 'installed'
	| 'error';

export type DictationModelInstallState = DictationModel & {
	installed: boolean;
	installing: boolean;
	installedSizeBytes: number;
	installStatus: DictationModelInstallStatus;
	progressBytes: number;
	totalBytes: number;
	error?: string;
	errorCode?: DictationErrorCode;
};

export type InstallDictationModelOptions = {
	force?: boolean;
};

export class DictationModelError extends Error {
	constructor(
		readonly code: DictationErrorCode,
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = 'DictationModelError';
	}
}

type ActiveInstall = {
	state: DictationModelInstallState;
	done: Promise<void>;
};

const activeInstalls = new Map<string, ActiveInstall>();
const lastInstallErrors = new Map<
	string,
	{ code: DictationErrorCode; message: string }
>();

export async function listDictationModelStates(
	models: DictationModel[],
): Promise<DictationModelInstallState[]> {
	return Promise.all(models.map((model) => getDictationModelState(model)));
}

export async function getDictationModelState(
	model: DictationModel,
): Promise<DictationModelInstallState> {
	const activeInstall = activeInstalls.get(model.id);
	if (activeInstall) return { ...activeInstall.state };

	const modelPath = getDictationModelPath(model.id);
	let installedSizeBytes = 0;
	let installed = false;
	try {
		const modelStat = await stat(modelPath);
		installed = modelStat.isFile();
		installedSizeBytes = installed ? modelStat.size : 0;
	} catch {
		installed = false;
	}

	const lastError = lastInstallErrors.get(model.id);
	return {
		...model,
		installed,
		installing: false,
		installedSizeBytes,
		installStatus: installed ? 'installed' : lastError ? 'error' : 'idle',
		progressBytes: installed ? installedSizeBytes : 0,
		totalBytes: model.sizeBytes,
		...(lastError && !installed
			? { error: lastError.message, errorCode: lastError.code }
			: {}),
	};
}

export async function installDictationModel(
	modelId: string,
	options: InstallDictationModelOptions = {},
): Promise<DictationModelInstallState> {
	const model = requireDictationModel(modelId);
	const activeInstall = activeInstalls.get(model.id);
	if (activeInstall) return { ...activeInstall.state };

	const existing = await getDictationModelState(model);
	if (existing.installed && !options.force) return existing;

	validateDownloadMetadata(model);
	await mkdir(getDictationModelsDir(), { recursive: true });
	lastInstallErrors.delete(model.id);

	const state: DictationModelInstallState = {
		...model,
		installed: false,
		installing: true,
		installedSizeBytes: 0,
		installStatus: 'installing',
		progressBytes: 0,
		totalBytes: model.sizeBytes,
	};

	const done = installModelInternal(model, options, state)
		.catch((error) => {
			const modelError = normalizeModelError(error);
			state.installing = false;
			state.installStatus = 'error';
			state.error = modelError.message;
			state.errorCode = modelError.code;
			lastInstallErrors.set(model.id, {
				code: modelError.code,
				message: modelError.message,
			});
		})
		.finally(() => {
			activeInstalls.delete(model.id);
		});

	activeInstalls.set(model.id, { state, done });
	void done;
	return { ...state };
}

export function getDictationModelInstallPromise(
	modelId: string,
): Promise<void> | undefined {
	return activeInstalls.get(modelId)?.done;
}

export async function removeDictationModel(
	modelId: string,
): Promise<{ removed: boolean; model: DictationModelInstallState }> {
	const model = requireDictationModel(modelId);
	if (activeInstalls.has(model.id)) {
		throw new DictationModelError(
			'DICTATION_MODEL_INSTALL_IN_PROGRESS',
			'Cannot remove a model while it is installing',
			409,
		);
	}
	const modelPath = getDictationModelPath(model.id);
	let removed = false;
	try {
		await rm(modelPath, { force: true });
		lastInstallErrors.delete(model.id);
		removed = true;
	} catch {
		removed = false;
	}
	return { removed, model: await getDictationModelState(model) };
}

export function requireDictationModel(modelId: string): DictationModel {
	const model = getDictationModel(modelId);
	if (!model) {
		throw new DictationModelError(
			'DICTATION_MODEL_NOT_FOUND',
			'Dictation model not found',
			404,
		);
	}
	return model;
}

async function installModelInternal(
	model: DictationModel,
	_options: InstallDictationModelOptions,
	state: DictationModelInstallState,
): Promise<void> {
	const downloadPath = getDictationModelDownloadPath(model.id);
	const modelPath = getDictationModelPath(model.id);

	try {
		const response = await fetch(model.url);
		if (!response.ok) {
			throw new DictationModelError(
				'DICTATION_MODEL_DOWNLOAD_FAILED',
				`Failed to download dictation model: HTTP ${response.status}`,
				502,
			);
		}

		await downloadModelResponse(response, model, state, downloadPath);
		state.installStatus = 'verifying';
		await rename(downloadPath, modelPath);
		const installed = await getDictationModelState(model);
		state.installed = true;
		state.installing = false;
		state.installedSizeBytes = installed.installedSizeBytes;
		state.installStatus = 'installed';
		state.progressBytes = installed.installedSizeBytes;
		state.totalBytes = model.sizeBytes;
		delete state.error;
		delete state.errorCode;
		lastInstallErrors.delete(model.id);
	} catch (error) {
		await rm(downloadPath, { force: true }).catch(() => {});
		throw error;
	}
}

async function downloadModelResponse(
	response: Response,
	model: DictationModel,
	state: DictationModelInstallState,
	downloadPath: string,
): Promise<void> {
	const file = await open(downloadPath, 'w');
	const hash = createHash('sha256');
	try {
		if (!response.body) {
			const bytes = Buffer.from(await response.arrayBuffer());
			assertModelSize(model, bytes.byteLength);
			hash.update(bytes);
			await file.write(bytes);
			state.progressBytes = bytes.byteLength;
		} else {
			const reader = response.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = Buffer.from(value);
				state.progressBytes += chunk.byteLength;
				assertModelSize(model, state.progressBytes);
				hash.update(chunk);
				await file.write(chunk);
			}
		}
	} finally {
		await file.close();
	}

	const sha256 = hash.digest('hex');
	if (sha256 !== model.sha256) {
		throw new DictationModelError(
			'DICTATION_MODEL_CHECKSUM_FAILED',
			'Downloaded dictation model checksum did not match',
			502,
		);
	}
}

function assertModelSize(model: DictationModel, sizeBytes: number) {
	if (sizeBytes > model.sizeBytes) {
		throw new DictationModelError(
			'DICTATION_MODEL_DOWNLOAD_FAILED',
			'Downloaded model is larger than expected',
			502,
		);
	}
}

function validateDownloadMetadata(model: DictationModel) {
	if (!model.url || !model.sha256 || model.sizeBytes <= 0) {
		throw new DictationModelError(
			'DICTATION_MODEL_DOWNLOAD_UNAVAILABLE',
			'Dictation model download metadata is not configured yet',
			501,
		);
	}
	if (!model.url.startsWith('https://')) {
		throw new DictationModelError(
			'DICTATION_MODEL_DOWNLOAD_FAILED',
			'Dictation model downloads must use HTTPS',
			400,
		);
	}
}

function normalizeModelError(error: unknown): DictationModelError {
	if (error instanceof DictationModelError) return error;
	return new DictationModelError(
		'DICTATION_MODEL_DOWNLOAD_FAILED',
		error instanceof Error ? error.message : String(error),
		502,
	);
}

export async function verifyInstalledDictationModel(
	modelId: string,
): Promise<boolean> {
	const model = requireDictationModel(modelId);
	if (!model.sha256) return (await getDictationModelState(model)).installed;
	try {
		const bytes = await readFile(getDictationModelPath(model.id));
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		return sha256 === model.sha256;
	} catch {
		return false;
	}
}
