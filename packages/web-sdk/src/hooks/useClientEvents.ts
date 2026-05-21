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
import { getBaseUrl } from '../lib/api-client/utils';
import { openUrl } from '../lib/open-url';
import {
	getPlatformWindowFocused,
	hasPlatformOpenUrl,
	openPlatformSession,
	showPlatformNotification,
} from '../lib/platform';
import { sessionsQueryKey } from './useSessions';

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

function requestNotificationPermission() {
	return new Promise<NotificationPermission>((resolve) => {
		let settled = false;
		let hasNativeRequest = false;
		const finish = (permission?: NotificationPermission) => {
			if (settled) return;
			settled = true;
			setTimeout(() => resolve(permission ?? Notification.permission), 100);
		};

		try {
			const result = Notification.requestPermission(finish);
			if (result && typeof result.then === 'function') {
				hasNativeRequest = true;
				result.then(finish).catch(() => finish());
			}
		} catch {
			finish();
		}

		if (!hasNativeRequest) {
			setTimeout(() => finish(), 60_000);
		}
	});
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
		sessionsQueryKey,
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
	const activeSessionIdRef = useRef(activeSessionId);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	useEffect(() => {
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
					const permission = await requestNotificationPermission();
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
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		const baseUrl = getBaseUrl();

		void createClientEventsStream(
			{
				baseUrl,
				onEvent: (event) => {
					if (event.event === 'heartbeat') return;

					let payload: unknown;
					try {
						payload = JSON.parse(event.data);
					} catch (error) {
						console.error('[client-events] Failed to parse event:', error);
						return;
					}

					if (event.event === 'session.status') {
						const status = payload as SessionStatusEvent;
						updateSessionStatusInCache(queryClient, status);
						if (status.status !== 'running') {
							void queryClient.invalidateQueries({
								queryKey: sessionsQueryKey,
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
							notification.source === 'session' || !!notification.sessionId;
						let sentSystemNotification = false;
						if (!isActiveVisibleSession) {
							sentSystemNotification = sendBrowserNotification(notification);
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
					if (!controller.signal.aborted) {
						console.error('[client-events] Stream error:', error);
						void maybeShowLocalAccessToast(baseUrl);
					}
				},
			},
			controller.signal,
		);

		return () => controller.abort();
	}, [queryClient]);

	return buildClientEventsStreamUrl({ baseUrl: getBaseUrl() });
}
