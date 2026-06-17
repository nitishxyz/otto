import { isPlatformDesktop } from './platform';

export type BrowserNotificationPermission =
	| NotificationPermission
	| 'unsupported';

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
	if (typeof window === 'undefined' || !('Notification' in window)) {
		return 'unsupported';
	}
	return Notification.permission;
}

export function getDefaultNotificationsEnabled(): boolean {
	if (isPlatformDesktop()) return true;
	return getBrowserNotificationPermission() === 'granted';
}

export function requestBrowserNotificationPermission() {
	return new Promise<NotificationPermission>((resolve) => {
		if (typeof window === 'undefined' || !('Notification' in window)) {
			resolve('denied');
			return;
		}

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
