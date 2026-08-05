import {
	getDictationStatus,
	installDictationModel,
	streamDictationModelInstall,
	type DictationModelState,
} from '@ottocode/api';
import { useKeyboard } from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiHeaders, getBaseUrl } from '../api.ts';
import { useTheme } from '../theme.ts';
import { ModalFrame } from './ModalFrame.tsx';
import { TinySpinner } from './TinySpinner.tsx';

interface DictationInstallOverlayProps {
	onClose: () => void;
	onReady: () => void;
}

export function DictationInstallOverlay({
	onClose,
	onReady,
}: DictationInstallOverlayProps) {
	const { colors } = useTheme();
	const [model, setModel] = useState<DictationModelState | null>(null);
	const [loading, setLoading] = useState(true);
	const [installing, setInstalling] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const installAbortRef = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await getDictationStatus();
			if (response.error || !response.data) {
				throw new Error(
					toErrorMessage(response.error, 'Dictation unavailable'),
				);
			}
			const nextModel =
				response.data.models.find(
					(item) => item.id === response.data?.defaultModel,
				) ??
				response.data.models.find((item) => item.recommended) ??
				response.data.models[0] ??
				null;
			setModel(nextModel);
		} catch (nextError) {
			setError(toErrorMessage(nextError, 'Failed to load dictation models'));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
		return () => installAbortRef.current?.abort();
	}, [load]);

	const installOrStart = useCallback(async () => {
		if (!model || installing || loading) return;
		if (model.installed) {
			onReady();
			return;
		}

		setInstalling(true);
		setError(null);
		try {
			const response = await installDictationModel({
				path: { model: model.id },
				body: {},
			});
			if (response.error || !response.data) {
				throw new Error(
					toErrorMessage(response.error, 'Could not install dictation model'),
				);
			}
			setModel(response.data.model);
			if (response.data.model.installing) {
				const controller = new AbortController();
				installAbortRef.current = controller;
				await streamDictationModelInstall({
					baseUrl: getBaseUrl(),
					model: model.id,
					headers: getApiHeaders(),
					signal: controller.signal,
					onModel: setModel,
				});
				installAbortRef.current = null;
				await load();
			}
		} catch (nextError) {
			if (!installAbortRef.current?.signal.aborted) {
				setError(toErrorMessage(nextError, 'Dictation model install failed'));
			}
		} finally {
			setInstalling(false);
		}
	}, [installing, load, loading, model, onReady]);

	useKeyboard((key) => {
		if (key.name === 'return') {
			key.preventDefault();
			key.stopPropagation();
			void installOrStart();
		} else if (key.name === 'escape' && !installing) {
			key.preventDefault();
			key.stopPropagation();
			onClose();
		}
	});

	const progress = model
		? Math.min(
				100,
				Math.round((model.progressBytes / Math.max(1, model.totalBytes)) * 100),
			)
		: 0;
	const progressWidth = 28;
	const filled = Math.round((progress / 100) * progressWidth);
	const action = model?.installed ? 'Start recording' : 'Download model';

	return (
		<ModalFrame
			title="Set up dictation"
			size="md"
			footer={
				installing
					? 'Downloading locally…'
					: `Enter ${action.toLowerCase()} · Esc cancel`
			}
		>
			<box style={{ flexDirection: 'column', gap: 1 }}>
				<text fg={colors.fgBright}>
					<b>Voice input needs one local model.</b>
				</text>
				<text fg={colors.fgMuted}>
					Audio is streamed to your Otto daemon and transcribed locally.
				</text>

				{loading ? (
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<TinySpinner fg={colors.blue} />
						<text fg={colors.fgMuted}>Checking local dictation…</text>
					</box>
				) : model ? (
					<box style={{ flexDirection: 'column', gap: 1 }}>
						<box style={{ flexDirection: 'row', gap: 1 }}>
							<text fg={colors.fgBright}>
								<b>{model.label}</b>
							</text>
							{model.recommended && <text fg={colors.blue}>recommended</text>}
						</box>
						<text fg={colors.fgMuted}>
							{formatBytes(model.sizeBytes)} ·{' '}
							{model.language === 'multi' ? 'Multilingual' : 'English'}
						</text>
						{model.installing || installing ? (
							<box style={{ flexDirection: 'column' }}>
								<text fg={colors.blue}>
									[{'█'.repeat(filled)}
									{'░'.repeat(progressWidth - filled)}] {progress}%
								</text>
								<text fg={colors.fgMuted}>Downloading model…</text>
							</box>
						) : model.installed ? (
							<text fg={colors.green}>✓ Ready for local dictation</text>
						) : (
							<text fg={colors.blue}>Enter to download this model</text>
						)}
					</box>
				) : (
					<text fg={colors.yellow}>No dictation models are available.</text>
				)}

				{error && <text fg={colors.red}>✗ {error}</text>}
			</box>
		</ModalFrame>
	);
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
	const megabytes = bytes / (1024 * 1024);
	return megabytes >= 1024
		? `${(megabytes / 1024).toFixed(1)} GB`
		: `${Math.round(megabytes)} MB`;
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object') {
		const value = error as { error?: unknown; message?: unknown };
		if (typeof value.error === 'string') return value.error;
		if (typeof value.message === 'string') return value.message;
	}
	return fallback;
}
