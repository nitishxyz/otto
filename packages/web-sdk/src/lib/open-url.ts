import { openPlatformUrl } from './platform';

export function openUrl(url: string) {
	if (openPlatformUrl(url)) {
		return;
	}

	if (window.self !== window.top) {
		window.parent.postMessage({ type: 'otto-open-url', url }, '*');
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}
