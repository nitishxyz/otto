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

function showInAppNotification(notification: NotificationEvent) {
	const message = notification.body
		? `${notification.title}: ${notification.body}`
		: notification.title;

	if (notification.action) {
		const id = toast(message, toastTypeForLevel(notification.level), 6000);
		useToastStore.getState().updateToast(id, { action: notification.action });
		return;
	}

	toast(message, toastTypeForLevel(notification.level), 5000);
}

function sendBrowserNotification(notification: NotificationEvent) {
	if (typeof window === 'undefined') return;

	if (window.parent && window.parent !== window) {
		const message: DesktopNotificationMessage = {
			type: 'otto-notification',
			notification,
		};
		window.parent.postMessage(message, '*');
		return;
	}

	if (!('Notification' in window) || Notification.permission !== 'granted')
		return;

	const browserNotification = new Notification(notification.title, {
		body: notification.body,
		tag: notification.id,
	});
	browserNotification.onclick = () => {
		window.focus();
		if (notification.sessionId) {
			window.location.href = `/sessions/${notification.sessionId}`;
		}
		browserNotification.close();
	};
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
					const permission = await Notification.requestPermission();
					if (permission === 'granted') {
						toast.success('Browser notifications enabled.');
					} else {
						toast.info('Browser notifications were not enabled.');
					}
				},
			},
		});
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		let hasShownLocalAccessToast = false;
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
						showInAppNotification(notification);

						const isActiveVisibleSession =
							notification.sessionId === activeSessionIdRef.current &&
							document.visibilityState === 'visible';
						if (!isActiveVisibleSession) {
							sendBrowserNotification(notification);
						}
					}
				},
				onError: (error) => {
					if (!controller.signal.aborted) {
						console.error('[client-events] Stream error:', error);
						if (!hasShownLocalAccessToast && isLocalApiUrl(baseUrl)) {
							hasShownLocalAccessToast = true;
							const id = toast(
								'Safari may need permission to access the local otto server.',
								'default',
								0,
							);
							useToastStore.getState().updateToast(id, {
								action: {
									label: 'Allow access',
									onClick: async () => {
										await requestLocalhostAccess(baseUrl);
										toast.success('Local otto server access confirmed.');
									},
								},
							});
						}
					}
				},
			},
			controller.signal,
		);

		return () => controller.abort();
	}, [queryClient]);

	return buildClientEventsStreamUrl({ baseUrl: getBaseUrl() });
}
