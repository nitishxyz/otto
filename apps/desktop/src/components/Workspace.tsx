import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
	isPermissionGranted,
	onAction,
	requestPermission,
	sendNotification,
} from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sun, Moon, ArrowDownToLine, RotateCw } from 'lucide-react';
import { useServer } from '../hooks/useServer';
import { useUpdate } from '../hooks/useUpdate';
import { usePlatform } from '../hooks/usePlatform';
import { useFullscreen } from '../hooks/useFullscreen';
import { handleTitleBarDrag } from '../utils/title-bar';
import type { Project } from '../lib/tauri-bridge';
import { tauriBridge } from '../lib/tauri-bridge';
import { SetuLoader } from './SetuLoader';
import { useDesktopTheme } from '../App';
import { WindowControls } from './WindowControls';
import { useVersion } from '../hooks/useVersion';

type OttoNotificationMessage = {
	type: 'otto-notification';
	notification?: {
		id: string;
		title: string;
		body?: string;
		sessionId?: string;
	};
};

const notificationSessions = new Map<number, string>();

function notificationIdFromString(id: string) {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0;
	}
	return Math.abs(hash || Date.now()) % 2_147_483_647;
}

async function showNativeNotification(message: OttoNotificationMessage) {
	const notification = message.notification;
	if (!notification?.title) return;
	const appWindow = getCurrentWindow();

	let permissionGranted = await isPermissionGranted();
	if (!permissionGranted) {
		const permission = await requestPermission();
		permissionGranted = permission === 'granted';
	}

	if (!permissionGranted) return;
	const id = notificationIdFromString(notification.id);
	if (notification.sessionId) {
		notificationSessions.set(id, notification.sessionId);
	}

	sendNotification({
		id,
		title: notification.title,
		body: notification.body,
		autoCancel: true,
		sound: 'Ping',
		extra: notification.sessionId
			? { sessionId: notification.sessionId, windowLabel: appWindow.label }
			: undefined,
	});
}

export function Workspace({
	project,
	onBack,
}: {
	project: Project;
	onBack: () => void;
}) {
	const { server, loading, error, startServer, startWebServer, stopServer } =
		useServer();
	const startedRef = useRef(false);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const pendingNavigationRef = useRef<{
		sessionId: string;
		timer: ReturnType<typeof setTimeout> | null;
	} | null>(null);
	const [iframeLoaded, setIframeLoaded] = useState(false);
	const platform = usePlatform();
	const isFullscreen = useFullscreen();
	const { theme, toggleTheme } = useDesktopTheme();
	const {
		available,
		version,
		downloading,
		downloaded,
		progress,
		downloadUpdate,
		applyUpdate,
		error: updateError,
	} = useUpdate();
	const appVersion = useVersion();

	const iframeSrc = useMemo(() => {
		if (!server) return null;
		return `${server.url}?_t=${Date.now()}&_pid=${server.pid}&_project=${encodeURIComponent(project.path)}`;
	}, [server, project.path]);
	const focusIframe = useCallback(() => {
		iframeRef.current?.contentWindow?.focus();
	}, []);
	const buildSessionUrl = useCallback(
		(sessionId: string) => {
			if (!server) return null;
			const url = new URL(
				`/sessions/${encodeURIComponent(sessionId)}`,
				server.url,
			);
			url.searchParams.set('_t', Date.now().toString());
			url.searchParams.set('_pid', server.pid.toString());
			url.searchParams.set('_project', project.path);
			return url.toString();
		},
		[server, project.path],
	);
	const loadSessionInIframe = useCallback(
		(sessionId: string) => {
			const url = buildSessionUrl(sessionId);
			const target = iframeRef.current;
			if (!url || !target) return false;

			setIframeLoaded(false);
			target.src = url;
			return true;
		},
		[buildSessionUrl],
	);
	const postSessionNavigation = useCallback(
		(sessionId: string) => {
			if (!server) return false;
			const target = iframeRef.current?.contentWindow;
			if (!target) return false;

			target.postMessage(
				{ type: 'otto-navigate-session', sessionId },
				new URL(server.url).origin,
			);
			return true;
		},
		[server],
	);
	const clearPendingNavigation = useCallback((sessionId?: string) => {
		const pending = pendingNavigationRef.current;
		if (!pending || (sessionId && pending.sessionId !== sessionId)) return;

		if (pending.timer) clearTimeout(pending.timer);
		pendingNavigationRef.current = null;
	}, []);

	const isRemote = !!project.remoteUrl;
	const openSession = useCallback(
		async (sessionId: string) => {
			if (!server) return;
			clearPendingNavigation();
			pendingNavigationRef.current = { sessionId, timer: null };
			const appWindow = getCurrentWindow();
			await appWindow.unminimize().catch(() => {});
			await appWindow.show().catch(() => {});
			await appWindow.setFocus().catch(() => {});

			if (postSessionNavigation(sessionId)) {
				const timer = setTimeout(() => {
					if (pendingNavigationRef.current?.sessionId === sessionId) {
						loadSessionInIframe(sessionId);
						clearPendingNavigation(sessionId);
					}
				}, 350);
				pendingNavigationRef.current = { sessionId, timer };
			} else {
				loadSessionInIframe(sessionId);
				clearPendingNavigation(sessionId);
			}

			focusIframe();
		},
		[
			server,
			clearPendingNavigation,
			postSessionNavigation,
			loadSessionInIframe,
			focusIframe,
		],
	);

	const handleBack = async () => {
		await stopServer();
		onBack();
	};

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		if (isRemote && project.remoteUrl) {
			startWebServer(project.remoteUrl, project.name);
		} else {
			startServer(project.path);
		}
	}, [
		project.path,
		project.name,
		project.remoteUrl,
		isRemote,
		startServer,
		startWebServer,
	]);

	useEffect(() => {
		if (!server) setIframeLoaded(false);
	}, [server]);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInIframe = target.ownerDocument !== document;
			if (isInIframe) return;

			const isInteractive = target.closest('button, a, input, [role="button"]');
			if (isInteractive) return;

			focusIframe();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [focusIframe]);

	useEffect(() => {
		let cancelled = false;
		const currentWindowLabel = getCurrentWindow().label;
		const listener = onAction((notification) => {
			const notificationWindowLabel =
				typeof notification.extra?.windowLabel === 'string'
					? notification.extra.windowLabel
					: undefined;
			if (
				notificationWindowLabel &&
				notificationWindowLabel !== currentWindowLabel
			) {
				return;
			}

			const sessionId =
				notification.id && notificationSessions.has(notification.id)
					? notificationSessions.get(notification.id)
					: notificationWindowLabel === currentWindowLabel &&
							typeof notification.extra?.sessionId === 'string'
						? notification.extra.sessionId
						: undefined;
			if (sessionId) {
				openSession(sessionId).catch((error: unknown) => {
					console.error('[otto] Failed to open notification session:', error);
				});
			}
		});

		return () => {
			cancelled = true;
			listener.then((l) => {
				if (cancelled) void l.unregister();
			});
		};
	}, [openSession]);

	useEffect(() => {
		const handler = (e: MessageEvent) => {
			if (e.source !== iframeRef.current?.contentWindow) return;

			if (
				e.data?.type === 'otto-navigate-session-ack' &&
				typeof e.data.sessionId === 'string'
			) {
				clearPendingNavigation(e.data.sessionId);
				return;
			}

			if (e.data?.type === 'otto-open-url' && typeof e.data.url === 'string') {
				openUrl(e.data.url).catch((err: unknown) => {
					console.error('[otto] Failed to open URL:', err);
				});
			}

			if (e.data?.type === 'otto-notification') {
				showNativeNotification(e.data as OttoNotificationMessage).catch(
					(error: unknown) => {
						console.error('[otto] Failed to show notification:', error);
					},
				);
			}

			if (
				e.data?.type === 'otto-font-family-changed' &&
				typeof e.data.fontFamily === 'string'
			) {
				document.documentElement.style.setProperty(
					'--otto-font-family',
					`"${e.data.fontFamily.replace(/"/g, '\\"')}", "IBM Plex Mono", monospace`,
				);
				window.localStorage.setItem(
					'otto-desktop-font-family',
					e.data.fontFamily,
				);
			}

			if (
				e.data?.type === 'otto-list-system-fonts' &&
				typeof e.data.requestId === 'string'
			) {
				const source = iframeRef.current?.contentWindow;
				if (!source) return;

				tauriBridge
					.listSystemFonts()
					.then((fonts) => {
						source.postMessage(
							{
								type: 'otto-system-fonts-result',
								requestId: e.data.requestId,
								fonts,
							},
							{ targetOrigin: e.origin },
						);
					})
					.catch((error: unknown) => {
						source.postMessage(
							{
								type: 'otto-system-fonts-result',
								requestId: e.data.requestId,
								error:
									error instanceof Error
										? error.message
										: 'Failed to list system fonts',
							},
							{ targetOrigin: e.origin },
						);
					});
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [clearPendingNavigation]);

	useEffect(() => {
		if (!iframeLoaded || !iframeRef.current?.contentWindow) return;
		iframeRef.current.contentWindow.postMessage(
			{ type: 'otto-set-theme', theme },
			'*',
		);
	}, [theme, iframeLoaded]);

	return (
		<div className="h-screen flex flex-col bg-background">
			<div
				className="flex items-center gap-2 px-4 h-10 border-b border-border cursor-default select-none bg-background relative"
				onMouseDown={handleTitleBarDrag}
				data-tauri-drag-region
				role="toolbar"
			>
				<div
					className={`flex items-center gap-2 ${platform === 'macos' && !isFullscreen ? 'ml-14' : ''}`}
				>
					<button
						type="button"
						onClick={handleBack}
						className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
					>
						←
					</button>
				</div>
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<span className="font-medium text-foreground truncate text-sm max-w-[40%]">
						{project.name}
					</span>
				</div>
				<div className="flex-1" />
				{available &&
					(downloaded ? (
						<button
							type="button"
							onClick={applyUpdate}
							className="h-6 px-2.5 flex items-center gap-1.5 text-xs font-medium bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors"
							title={`Restart to update to v${version}`}
						>
							<RotateCw className="w-3 h-3" />
							Restart
						</button>
					) : (
						<button
							type="button"
							onClick={downloadUpdate}
							disabled={downloading}
							className="h-6 px-2.5 flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white rounded-full hover:bg-blue-500 transition-colors disabled:opacity-60"
							title={`Update to v${version}`}
						>
							<ArrowDownToLine className="w-3 h-3" />
							{downloading ? `${progress}%` : 'Update'}
						</button>
					))}
				{updateError && (
					<span
						className="text-xs text-red-400 max-w-[200px] truncate"
						title={updateError}
					>
						⚠ {updateError}
					</span>
				)}
				{server && (
					<div className="flex items-center gap-1.5 text-xs">
						<span className="w-2 h-2 rounded-full bg-green-500" />
						<span className="text-muted-foreground">Port {server.webPort}</span>
						{appVersion && (
							<span className="text-muted-foreground/50">· v{appVersion}</span>
						)}
					</div>
				)}
				{isRemote && (
					<div className="flex items-center gap-1.5 text-xs">
						<span className="w-2 h-2 rounded-full bg-blue-500" />
						<span className="text-muted-foreground">Remote</span>
					</div>
				)}
				<button
					type="button"
					onClick={toggleTheme}
					className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
					title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
				>
					{theme === 'dark' ? (
						<Sun className="w-3.5 h-3.5" />
					) : (
						<Moon className="w-3.5 h-3.5" />
					)}
				</button>
				<button
					type="button"
					onClick={() => tauriBridge.createNewWindow()}
					className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
					title="New Window"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<rect x="1" y="1" width="14" height="14" rx="2" />
						<line x1="8" y1="4.5" x2="8" y2="11.5" />
						<line x1="4.5" y1="8" x2="11.5" y2="8" />
					</svg>
				</button>
				{platform === 'linux' && <WindowControls />}
			</div>

			<div className="flex-1 relative flex items-center justify-center bg-background">
				{(loading || (server && !iframeLoaded)) && (
					<SetuLoader
						label={
							loading
								? isRemote
									? 'Connecting to remote server...'
									: 'Starting server...'
								: 'Loading...'
						}
					/>
				)}
				{error && !loading && (
					<div className="text-center max-w-md">
						<div className="text-destructive mb-4">{error}</div>
						<button
							type="button"
							onClick={() => {
								startedRef.current = false;
								if (isRemote && project.remoteUrl) {
									startWebServer(project.remoteUrl, project.name);
								} else {
									startServer(project.path);
								}
							}}
							className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
						>
							Retry
						</button>
					</div>
				)}
				{server && iframeSrc && (
					<iframe
						ref={iframeRef}
						src={iframeSrc ?? ''}
						className={`absolute inset-0 w-full h-full border-none transition-opacity duration-200 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
						style={{ backgroundColor: 'hsl(var(--background))' }}
						title="otto workspace"
						allow="clipboard-write; clipboard-read"
						onLoad={() => {
							setIframeLoaded(true);
							focusIframe();
							iframeRef.current?.contentWindow?.postMessage(
								{ type: 'otto-set-theme', theme },
								'*',
							);
							const pendingSessionId = pendingNavigationRef.current?.sessionId;
							if (pendingSessionId) {
								postSessionNavigation(pendingSessionId);
							}
						}}
					/>
				)}
			</div>
		</div>
	);
}
