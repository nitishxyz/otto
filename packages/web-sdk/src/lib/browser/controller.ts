import { pollBrowserCommand, submitBrowserCommandResult } from '@ottocode/api';
import {
	actionScript,
	pageStateScript,
	scrollIntoViewScript,
	type BrowserControlCommand,
} from './page-scripts';

interface BrowserControlWireCommand
	extends Omit<BrowserControlCommand, 'args'> {
	args: string;
}

export interface BrowserPageCapture {
	/** Base64 encoded image bytes. */
	data: string;
	mediaType: string;
}

export interface BrowserPageExecutor {
	execute(script: string): Promise<unknown>;
	/** Reports viewer tab metadata to browser tab discovery. */
	metadata?(): {
		url?: string;
		title?: string;
		kind?: 'browser' | 'simulator';
	};
	/** Host-side screen capture; unavailable for iframe-based previews. */
	capture?(): Promise<BrowserPageCapture>;
	/** Opens a page-requested window as a controllable Otto browser tab. */
	openTab?(url: string): Promise<string | null>;
}

type PageResult = Record<string, unknown>;

const READY_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;
const NAVIGATION_ACTIONS = new Set(['navigate', 'back', 'forward', 'reload']);

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeResult(value: unknown): PageResult {
	let decoded = value;
	for (let index = 0; index < 2 && typeof decoded === 'string'; index += 1) {
		try {
			decoded = JSON.parse(decoded);
		} catch {
			break;
		}
	}
	if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
		return decoded as PageResult;
	}
	return { ok: true, value: decoded };
}

function errorResult(error: unknown): PageResult {
	return {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

function stringField(result: PageResult | null, key: string): string {
	const value = result?.[key];
	return typeof value === 'string' ? value : '';
}

async function readPageState(
	executor: BrowserPageExecutor,
): Promise<PageResult | null> {
	try {
		const state = decodeResult(await executor.execute(pageStateScript));
		return state.ok === false ? null : state;
	} catch {
		return null;
	}
}

/** Waits until the document left the loading state so actions hit a live DOM. */
async function waitForDocumentReady(
	executor: BrowserPageExecutor,
): Promise<PageResult | null> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	let state = await readPageState(executor);
	while (Date.now() < deadline) {
		if (state && state.readyState !== 'loading') return state;
		await delay(POLL_INTERVAL_MS);
		state = await readPageState(executor);
	}
	return state;
}

async function runNavigation(
	command: BrowserControlCommand,
	executor: BrowserPageExecutor,
	referenceChannel: string,
): Promise<PageResult> {
	const before = await readPageState(executor);
	const previousUrl = stringField(before, 'url');
	const dispatched = decodeResult(
		await executor.execute(actionScript(command, referenceChannel)),
	);
	if (dispatched.ok === false) return dispatched;

	const requiresUrlChange = command.action !== 'reload';
	const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
	let last: PageResult | null = null;
	await delay(POLL_INTERVAL_MS);

	while (Date.now() < deadline) {
		const state = await readPageState(executor);
		if (state) {
			last = state;
			const url = stringField(state, 'url');
			const urlChanged = url !== previousUrl;
			if (
				state.readyState === 'complete' &&
				(urlChanged || !requiresUrlChange)
			) {
				return {
					ok: true,
					url,
					title: state.title,
					readyState: state.readyState,
					urlChanged,
				};
			}
		}
		await delay(POLL_INTERVAL_MS);
	}

	return {
		ok: true,
		url: stringField(last, 'url') || previousUrl,
		title: last?.title,
		readyState: last?.readyState ?? 'unknown',
		urlChanged: stringField(last, 'url') !== previousUrl,
		warning:
			'The page did not finish loading within 15s. Retry snapshot to read the settled page.',
	};
}

async function runWaitFor(
	command: BrowserControlCommand,
	executor: BrowserPageExecutor,
	referenceChannel: string,
): Promise<PageResult> {
	const timeout = Math.max(100, Number(command.args.timeoutMs) || 5_000);
	const deadline = Date.now() + timeout;
	const script = actionScript(command, referenceChannel);
	let last: PageResult = {
		ok: false,
		error: 'Timed out waiting for the page condition',
	};

	do {
		try {
			last = decodeResult(await executor.execute(script));
			if (last.ok !== false) return last;
		} catch (error) {
			last = errorResult(error);
		}
		await delay(POLL_INTERVAL_MS);
	} while (Date.now() < deadline);

	return last;
}

async function runScreenshot(
	command: BrowserControlCommand,
	executor: BrowserPageExecutor,
	referenceChannel: string,
): Promise<PageResult> {
	if (!executor.capture) {
		return {
			ok: false,
			error:
				'Screenshots require the Otto desktop app; the web preview cannot capture an embedded page. Use snapshot or html to inspect this page.',
		};
	}

	const selector =
		typeof command.args.selector === 'string' ? command.args.selector : '';
	if (selector) {
		const scrolled = decodeResult(
			await executor.execute(scrollIntoViewScript(selector, referenceChannel)),
		);
		if (scrolled.ok === false) return scrolled;
		await delay(POLL_INTERVAL_MS);
	}

	const state = await readPageState(executor);
	const capture = await executor.capture();
	if (!capture?.data) {
		return { ok: false, error: 'The preview returned an empty screenshot.' };
	}
	return {
		ok: true,
		data: capture.data,
		mediaType: capture.mediaType,
		url: state?.url,
		title: state?.title,
	};
}

async function executeCommand(
	command: BrowserControlCommand,
	executor: BrowserPageExecutor,
	referenceChannel: string,
): Promise<PageResult> {
	try {
		if (command.action === 'stop') {
			return decodeResult(
				await executor.execute(actionScript(command, referenceChannel)),
			);
		}

		await waitForDocumentReady(executor);

		if (NAVIGATION_ACTIONS.has(command.action)) {
			return await runNavigation(command, executor, referenceChannel);
		}
		if (command.action === 'wait_for') {
			return await runWaitFor(command, executor, referenceChannel);
		}
		if (command.action === 'screenshot') {
			return await runScreenshot(command, executor, referenceChannel);
		}
		const result = decodeResult(
			await executor.execute(actionScript(command, referenceChannel)),
		);
		if (command.action === 'click') {
			const newTab = result.newTab;
			const url =
				newTab && typeof newTab === 'object' && !Array.isArray(newTab)
					? (newTab as Record<string, unknown>).url
					: undefined;
			if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
				if (executor.openTab) {
					const tabId = await executor.openTab(url);
					result.newTab = { url, tabId };
				} else {
					result.warning =
						'The page requested a new tab, but this client cannot open it.';
				}
			}
		}
		return result;
	} catch (error) {
		return errorResult(error);
	}
}

/** Connects a mounted browser surface to server-side browser tool commands. */
export function connectBrowserController(
	tabId: string,
	executor: BrowserPageExecutor,
): () => void {
	const abortController = new AbortController();
	const referenceChannel = crypto.randomUUID();

	void (async () => {
		while (!abortController.signal.aborted) {
			try {
				const reported = executor.metadata?.() ?? {};
				const metadata = {
					url: reported.url?.slice(0, 8_192),
					title: reported.title?.slice(0, 512),
					kind: reported.kind,
				};
				const response = await pollBrowserCommand({
					query: { tabId, ...metadata },
					signal: abortController.signal,
				});
				if (response.error) throw new Error('Browser command poll failed');
				const payload = response.data as {
					command: BrowserControlWireCommand | null;
				};
				if (!payload.command) continue;
				const command: BrowserControlCommand = {
					...payload.command,
					args: JSON.parse(payload.command.args) as Record<string, unknown>,
				};
				const result = await executeCommand(
					command,
					executor,
					referenceChannel,
				);
				const completion = await submitBrowserCommandResult({
					path: { commandId: payload.command.id },
					body: { result: JSON.stringify(result) },
					signal: abortController.signal,
				});
				if (completion.error) {
					throw new Error('Browser command result was not accepted');
				}
			} catch (error) {
				if (abortController.signal.aborted) return;
				console.warn('[otto] Browser controller reconnecting:', error);
				await delay(1_000);
			}
		}
	})();

	return () => abortController.abort();
}
