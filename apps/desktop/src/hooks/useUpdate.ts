import { useCallback, useSyncExternalStore } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { listen } from '@tauri-apps/api/event';

interface UpdateInfo {
	version: string;
	currentVersion: string;
}

type DownloadEvent =
	| { event: 'started'; data: { contentLength: number | null } }
	| { event: 'progress'; data: { chunkLength: number; downloaded: number } }
	| { event: 'finished' };

interface UpdateState {
	available: boolean;
	version: string | null;
	downloading: boolean;
	downloaded: boolean;
	progress: number;
	totalBytes: number;
	error: string | null;
}

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

const initialState: UpdateState = {
	available: false,
	version: null,
	downloading: false,
	downloaded: false,
	progress: 0,
	totalBytes: 0,
	error: null,
};

let state: UpdateState = { ...initialState };
const listeners = new Set<() => void>();
let downloadPromise: Promise<void> | null = null;
let subscriberCount = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let menuUnlisten: (() => void) | null = null;
let effectsGeneration = 0;

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function setState(
	partial: Partial<UpdateState> | ((prev: UpdateState) => UpdateState),
) {
	state =
		typeof partial === 'function' ? partial(state) : { ...state, ...partial };
	emit();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	subscriberCount += 1;
	if (subscriberCount === 1) {
		startGlobalEffects();
	}
	return () => {
		listeners.delete(listener);
		subscriberCount -= 1;
		if (subscriberCount === 0) {
			stopGlobalEffects();
		}
	};
}

function getSnapshot() {
	return state;
}

async function checkForUpdate() {
	try {
		const result = await invoke<UpdateInfo | null>('check_for_update');
		if (result) {
			setState({
				available: true,
				version: result.version,
				error: null,
			});
		}
	} catch (e) {
		console.error('[otto] Update check failed:', e);
		setState({ error: String(e) });
	}
}

function startGlobalEffects() {
	const generation = ++effectsGeneration;
	void checkForUpdate();
	intervalId = setInterval(() => {
		void checkForUpdate();
	}, UPDATE_CHECK_INTERVAL);
	void listen('menu-check-for-updates', () => {
		void checkForUpdate();
	}).then((unlisten) => {
		if (generation !== effectsGeneration) {
			unlisten();
			return;
		}
		menuUnlisten = unlisten;
	});
}

function stopGlobalEffects() {
	effectsGeneration += 1;
	if (intervalId !== null) {
		clearInterval(intervalId);
		intervalId = null;
	}
	if (menuUnlisten !== null) {
		menuUnlisten();
		menuUnlisten = null;
	}
}

async function downloadUpdateImpl(): Promise<void> {
	if (downloadPromise) {
		return downloadPromise;
	}

	downloadPromise = (async () => {
		try {
			setState({
				downloading: true,
				downloaded: false,
				progress: 0,
				totalBytes: 0,
				error: null,
			});

			const onEvent = new Channel<DownloadEvent>();
			onEvent.onmessage = (event) => {
				if (event.event === 'started' && event.data.contentLength) {
					setState({
						totalBytes: event.data.contentLength ?? 0,
					});
				} else if (event.event === 'progress') {
					setState((s) => {
						const pct =
							s.totalBytes > 0
								? Math.round((event.data.downloaded / s.totalBytes) * 100)
								: 0;
						return { ...s, progress: pct };
					});
				} else if (event.event === 'finished') {
					setState({
						downloading: false,
						downloaded: true,
						progress: 100,
					});
				}
			};

			await invoke('download_update', { onEvent });
			setState({
				downloading: false,
				downloaded: true,
				progress: 100,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setState({ downloading: false, error: msg });
		} finally {
			downloadPromise = null;
		}
	})();

	return downloadPromise;
}

async function applyUpdateImpl() {
	try {
		await invoke('apply_update');
		await relaunch();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		setState({ error: msg });
	}
}

export function useUpdate() {
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const downloadUpdate = useCallback(() => downloadUpdateImpl(), []);
	const applyUpdate = useCallback(() => applyUpdateImpl(), []);
	const checkForUpdateStable = useCallback(() => checkForUpdate(), []);

	return {
		...snapshot,
		downloadUpdate,
		applyUpdate,
		checkForUpdate: checkForUpdateStable,
	};
}
