// Extend Window interface to include custom properties
interface OttoWindow extends Window {
	__OTTO_API_URL__?: string;
	OTTO_SERVER_URL?: string;
}

export const RUNTIME_API_BASE_URL_STORAGE_KEY = 'otto-api-base-url';

export function normalizeApiBaseUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error('Enter an otto tunnel URL.');
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error('Enter a valid URL, including http:// or https://.');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Tunnel URL must start with http:// or https://.');
	}

	url.hash = '';
	url.pathname = url.pathname.replace(/\/+$/, '') || '';
	return url.toString().replace(/\/+$/, '');
}

function getStoredApiBaseUrl(): string | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return (
			window.localStorage.getItem(RUNTIME_API_BASE_URL_STORAGE_KEY) ?? undefined
		);
	} catch {
		return undefined;
	}
}

export function getConfiguredRuntimeApiBaseUrl(): string | undefined {
	if (typeof window === 'undefined') return undefined;

	const params = new URLSearchParams(window.location.search);
	const urlParam = params.get('url');
	if (urlParam) return normalizeApiBaseUrl(urlParam);

	const win = window as OttoWindow;
	if (win.OTTO_SERVER_URL) return normalizeApiBaseUrl(win.OTTO_SERVER_URL);
	if (win.__OTTO_API_URL__) return normalizeApiBaseUrl(win.__OTTO_API_URL__);

	const storedUrl = getStoredApiBaseUrl();
	if (storedUrl) return normalizeApiBaseUrl(storedUrl);

	return undefined;
}

export function hasConfiguredRuntimeApiBaseUrl(): boolean {
	return Boolean(getConfiguredRuntimeApiBaseUrl());
}

export function setRuntimeApiBaseUrl(value: string): string {
	const baseUrl = normalizeApiBaseUrl(value);
	if (typeof window !== 'undefined') {
		const win = window as OttoWindow;
		win.OTTO_SERVER_URL = baseUrl;
		try {
			window.localStorage.setItem(RUNTIME_API_BASE_URL_STORAGE_KEY, baseUrl);
		} catch {
			// Ignore storage errors; the in-memory URL still works for this page load.
		}
	}
	return baseUrl;
}

export function clearRuntimeApiBaseUrl() {
	if (typeof window === 'undefined') return;
	const win = window as OttoWindow;
	delete win.OTTO_SERVER_URL;
	delete win.__OTTO_API_URL__;
	try {
		window.localStorage.removeItem(RUNTIME_API_BASE_URL_STORAGE_KEY);
	} catch {
		// Ignore storage errors.
	}
}

// This function will execute at runtime in the browser
function computeApiBaseUrl(): string {
	const runtimeUrl = getConfiguredRuntimeApiBaseUrl();
	if (runtimeUrl) {
		return runtimeUrl;
	}

	const envUrl = import.meta.env?.VITE_API_BASE_URL;
	if (envUrl) return normalizeApiBaseUrl(envUrl);

	// Fallback for standalone dev
	return 'http://localhost:9100';
}

export function getRuntimeApiBaseUrl(): string {
	return computeApiBaseUrl();
}

export const API_BASE_URL = computeApiBaseUrl();

export const config = {
	apiBaseUrl: API_BASE_URL,
};
