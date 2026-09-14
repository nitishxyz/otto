import type { NativeBrowserNavigationEvent } from './native-browser';

const METADATA_SCRIPT =
	'({ url: location.href, title: document.title, loading: document.readyState !== "complete" })';

export function observeNativeBrowserMetadata(
	id: string,
	execute: (script: string) => Promise<unknown>,
	listener: (event: NativeBrowserNavigationEvent) => void,
	intervalMs = 500,
): () => void {
	let stopped = false;
	let pending = false;
	let previous: string | undefined;
	const sample = async () => {
		if (pending || stopped) return;
		pending = true;
		try {
			const result = await execute(METADATA_SCRIPT);
			if (stopped || !result || typeof result !== 'object') return;
			if (
				!('url' in result) ||
				typeof result.url !== 'string' ||
				!('title' in result) ||
				typeof result.title !== 'string' ||
				!('loading' in result) ||
				typeof result.loading !== 'boolean' ||
				!/^https?:\/\//.test(result.url)
			)
				return;
			const event = {
				id,
				url: result.url,
				title: result.title,
				loading: result.loading,
			};
			const serialized = JSON.stringify(event);
			if (serialized !== previous) {
				previous = serialized;
				listener(event);
			}
		} catch {
			// Mounting and cross-document navigation can temporarily remove the JS context.
		} finally {
			pending = false;
		}
	};
	const timer = setInterval(() => void sample(), intervalMs);
	void sample();
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
