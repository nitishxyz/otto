import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
	buildClientEventsStreamUrl,
	createClientEventsStream,
	type NotificationEvent,
	type SessionStatusEvent,
} from '@ottocode/api';
import { toast, useToastStore } from '../stores/toastStore';
import type { SessionsPage } from '../types/api';
import {
	getAuthHeaders,
	getBaseUrl,
	getProjectId,
	getProjectKey,
} from '../lib/api-client/utils';
import { openUrl } from '../lib/open-url';
import {
	getPlatformWindowFocused,
	hasPlatformOpenUrl,
	isPlatformDesktop,
	openPlatformSession,
	showPlatformNotification,
} from '../lib/platform';
import { requestBrowserNotificationPermission } from '../lib/notifications';
import { usePreferences } from './usePreferences';
import { getSessionsQueryKey } from './useSessions';

type DesktopNotificationMessage = {
	type: 'otto-notification';
	notification: NotificationEvent;
};

function toastTypeForLevel(level: NotificationEvent['level']) {
	if (level === 'success') return 'success';
	if (level === 'error') return 'error';
	return 'default';
}

function notificationTargetHref(notification: NotificationEvent) {
	return (
		notification.action?.href ??
		(notification.sessionId
			? `/sessions/${encodeURIComponent(notification.sessionId)}`
			: undefined)
	);
}

function openNotificationTarget(notification: NotificationEvent) {
	const href = notificationTargetHref(notification);
	if (!href || typeof window === 'undefined') return;

	if (notification.sessionId && openPlatformSession(notification.sessionId)) {
		return;
	}

	if (href.startsWith('/')) {
		window.location.href = href;
		return;
	}

	openUrl(href);
}

function showInAppNotification(notification: NotificationEvent) {
	const message = notification.body
		? `${notification.title}: ${notification.body}`
		: notification.title;
	const targetHref = notificationTargetHref(notification);

	if (targetHref) {
		const id = toast(message, toastTypeForLevel(notification.level), 6000);
		useToastStore.getState().updateToast(id, {
			activateActionOnClick: true,
			action: notification.action
				? {
						...notification.action,
						onClick: () => openNotificationTarget(notification),
					}
				: {
						label: 'Open session',
						onClick: () => openNotificationTarget(notification),
					},
		});
		return;
	}

	toast(message, toastTypeForLevel(notification.level), 5000);
}

function sendBrowserNotification(notification: NotificationEvent) {
	if (typeof window === 'undefined') return false;
	if (showPlatformNotification(notification)) return true;

	if (window.parent && window.parent !== window) {
		const message: DesktopNotificationMessage = {
			type: 'otto-notification',
			notification,
		};
		window.parent.postMessage(message, '*');
		return true;
	}

	if (!('Notification' in window) || Notification.permission !== 'granted')
		return false;

	const browserNotification = new Notification(notification.title, {
		body: notification.body,
		tag: notification.id,
		data: { href: notificationTargetHref(notification) },
	});
	browserNotification.onclick = () => {
		window.focus();
		openNotificationTarget(notification);
		browserNotification.close();
	};
	return true;
}

function isAppForeground() {
	return getPlatformWindowFocused() ?? document.visibilityState === 'visible';
}

function updateSessionStatusInCache(
	queryClient: ReturnType<typeof useQueryClient>,
	status: SessionStatusEvent,
) {
	queryClient.setQueryData<{ pages: SessionsPage[]; pageParams: number[] }>(
		getSessionsQueryKey(),
		(old) => {
			if (!old) return old;
			return {
				...old,
				pages: old.pages.map((page) => ({
					...page,
					items: page.items.map((session) =>
						session.id === status.sessionId
							? {
									...session,
									isRunning: status.status === 'running',
								}
							: session,
					),
				})),
			};
		},
	);
}

function isLocalApiUrl(baseUrl: string) {
	try {
		const { hostname } = new URL(baseUrl);
		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname.startsWith('192.168.') ||
			hostname.startsWith('10.') ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
		);
	} catch {
		return false;
	}
}

async function requestLocalhostAccess(baseUrl: string) {
	const response = await fetch(new URL('/openapi.json', baseUrl), {
		cache: 'no-store',
		credentials: 'include',
	});
	if (!response.ok) {
		throw new Error(`Local API returned ${response.status}`);
	}
}

const localAccessToastIds = new Map<string, string>();
const localAccessChecksInFlight = new Set<string>();

function localAccessStorageKey(baseUrl: string) {
	return `otto-local-access-confirmed:${baseUrl}`;
}

function hasConfirmedLocalAccess(baseUrl: string) {
	try {
		return window.localStorage.getItem(localAccessStorageKey(baseUrl)) === '1';
	} catch {
		return false;
	}
}

function markLocalAccessConfirmed(baseUrl: string) {
	try {
		window.localStorage.setItem(localAccessStorageKey(baseUrl), '1');
	} catch {
		// Ignore storage failures; the in-memory toast map still prevents spam.
	}
}

async function maybeShowLocalAccessToast(baseUrl: string) {
	if (hasPlatformOpenUrl()) return;
	if (!isLocalApiUrl(baseUrl) || hasConfirmedLocalAccess(baseUrl)) return;
	if (
		localAccessToastIds.has(baseUrl) ||
		localAccessChecksInFlight.has(baseUrl)
	) {
		return;
	}

	localAccessChecksInFlight.add(baseUrl);
	try {
		await requestLocalhostAccess(baseUrl);
		markLocalAccessConfirmed(baseUrl);
		return;
	} catch {
		// Show the manual permission toast below.
	} finally {
		localAccessChecksInFlight.delete(baseUrl);
	}

	if (localAccessToastIds.has(baseUrl)) return;
	const id = toast(
		'Safari may need permission to access the local otto server.',
		'default',
		0,
	);
	localAccessToastIds.set(baseUrl, id);
	useToastStore.getState().updateToast(id, {
		action: {
			label: 'Allow access',
			onClick: async () => {
				await requestLocalhostAccess(baseUrl);
				markLocalAccessConfirmed(baseUrl);
				useToastStore.getState().removeToast(id);
				localAccessToastIds.delete(baseUrl);
				toast.success('Local otto server access confirmed.');
			},
		},
	});
}

export function useClientEvents(activeSessionId?: string) {
	const queryClient = useQueryClient();
	const { preferences } = usePreferences();
	const activeSessionIdRef = useRef(activeSessionId);
	const notificationsEnabledRef = useRef(preferences.notificationsEnabled);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	useEffect(() => {
		notificationsEnabledRef.current = preferences.notificationsEnabled;
	}, [preferences.notificationsEnabled]);

	useEffect(() => {
		if (!preferences.notificationsEnabled) return;
		if (isPlatformDesktop()) return;
		if (typeof window === 'undefined' || window.parent !== window) return;
		if (!('Notification' in window)) return;
		if (Notification.permission !== 'default') return;
		if (window.localStorage.getItem('otto-notification-permission-prompted')) {
			return;
		}

		window.localStorage.setItem('otto-notification-permission-prompted', '1');
		const id = toast(
			'Enable browser notifications for background session updates.',
			'default',
			0,
		);
		useToastStore.getState().updateToast(id, {
			action: {
				label: 'Enable',
				onClick: async () => {
					const permission = await requestBrowserNotificationPermission();
					const currentPermission = Notification.permission;
					if (permission === 'granted' || currentPermission === 'granted') {
						toast.success('Browser notifications enabled.');
					} else if (
						permission === 'default' &&
						currentPermission === 'default'
					) {
						return;
					} else {
						toast.info('Browser notifications were not enabled.');
					}
				},
			},
		});
	}, [preferences.notificationsEnabled]);
	const projectKey = getProjectKey();

	useEffect(() => {
		void projectKey;
		const controller = new AbortController();
		const baseUrl = getBaseUrl();
		const projectId = getProjectId();

		const STALL_TIMEOUT_MS = 20000;
		const RECONNECT_DELAY_MS = 2000;

		const runStream = async () => {
			while (!controller.signal.aborted) {
				const attempt = new AbortController();
				const onOuterAbort = () => attempt.abort();
				controller.signal.addEventListener('abort', onOuterAbort, {
					once: true,
				});
				let lastEventAt = Date.now();
				const watchdog = setInterval(() => {
					if (Date.now() - lastEventAt > STALL_TIMEOUT_MS) {
						console.warn(
							'[client-events] No events received, dropping stalled connection',
						);
						attempt.abort();
					}
				}, 5000);

				try {
					await createClientEventsStream(
						{
							baseUrl,
							projectId,
							headers: getAuthHeaders(),
							onEvent: (event) => {
								lastEventAt = Date.now();
								if (event.event === 'heartbeat') return;

								let payload: unknown;
								try {
									payload = JSON.parse(event.data);
								} catch (error) {
									console.error(
										'[client-events] Failed to parse event:',
										error,
									);
									return;
								}

								if (event.event === 'session.status') {
									const status = payload as SessionStatusEvent;
									updateSessionStatusInCache(queryClient, status);
									if (status.status !== 'running') {
										void queryClient.invalidateQueries({
											queryKey: getSessionsQueryKey(),
										});
									}
									return;
								}

								if (event.event === 'notification') {
									const notification = payload as NotificationEvent;
									const isActiveVisibleSession =
										notification.sessionId === activeSessionIdRef.current &&
										isAppForeground();
									const isSessionNotification =
										notification.source === 'session' ||
										!!notification.sessionId;
									let sentSystemNotification = false;
									if (
										notificationsEnabledRef.current &&
										!isActiveVisibleSession
									) {
										sentSystemNotification =
											sendBrowserNotification(notification);
									}

									if (
										!isSessionNotification ||
										(!sentSystemNotification && !isActiveVisibleSession)
									) {
										showInAppNotification(notification);
									}
								}
							},
							onError: (error) => {
								if (!controller.signal.aborted && !attempt.signal.aborted) {
									console.error('[client-events] Stream error:', error);
									void maybeShowLocalAccessToast(baseUrl);
								}
							},
						},
						attempt.signal,
					);
				} finally {
					clearInterval(watchdog);
					controller.signal.removeEventListener('abort', onOuterAbort);
				}

				if (controller.signal.aborted) break;
				await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
			}
		};

		void runStream();

		return () => controller.abort();
	}, [queryClient, projectKey]);

	return buildClientEventsStreamUrl({
		baseUrl: getBaseUrl(),
		projectId: getProjectId(),
	});
}
