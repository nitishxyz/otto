import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SSETransport } from '@ottocode/web-sdk/lib';

const BROKER_EVENT = 'otto:desktop-event-stream';

interface DesktopEventSource {
	baseUrl: string;
	token: string;
	projectId: string;
	projectRoot: string;
}

type BrokerState =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'retrying'
	| 'unsupported';

type BrokerMessage =
	| {
			kind: 'state';
			status: BrokerState;
			attempt: number;
			delay: number;
	  }
	| { kind: 'chunk'; chunk: string };

interface BrokerStatus {
	status: BrokerState;
}

function isProjectEventsUrl(url: string, source: DesktopEventSource): boolean {
	try {
		const request = new URL(url);
		const daemon = new URL(source.baseUrl);
		return (
			request.origin === daemon.origin &&
			request.pathname === '/v1/events/project'
		);
	} catch {
		return false;
	}
}

export function createDesktopEventTransport(
	source: DesktopEventSource,
): SSETransport {
	return async (url, init) => {
		if (!isProjectEventsUrl(url, source)) return undefined;

		const subscriptionId = crypto.randomUUID();
		const encoder = new TextEncoder();
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		let unlisten: UnlistenFn | undefined;
		let settled = false;
		let closed = false;
		let abort = () => {};
		let resolveResponse: (response: Response | undefined) => void = () => {};
		let rejectResponse: (error: unknown) => void = () => {};
		const response = new Promise<Response | undefined>((resolve, reject) => {
			resolveResponse = resolve;
			rejectResponse = reject;
		});

		const unsubscribe = () => {
			init.signal?.removeEventListener('abort', abort);
			unlisten?.();
			unlisten = undefined;
			void invoke('unsubscribe_desktop_events', { subscriptionId }).catch(
				() => {},
			);
		};
		const close = () => {
			if (closed) return;
			closed = true;
			try {
				controller?.close();
			} catch {}
			unsubscribe();
		};
		const fallback = () => {
			if (settled) return;
			settled = true;
			closed = true;
			unsubscribe();
			resolveResponse(undefined);
		};
		const connect = () => {
			if (settled || closed) return;
			settled = true;
			const stream = new ReadableStream<Uint8Array>({
				start(streamController) {
					controller = streamController;
					streamController.enqueue(
						encoder.encode(': connected native-desktop-events\n\n'),
					);
				},
				cancel: close,
			});
			resolveResponse(
				new Response(stream, {
					status: 200,
					headers: { 'content-type': 'text/event-stream' },
				}),
			);
		};
		const onState = (status: BrokerState) => {
			if (status === 'connected') connect();
			else if (status === 'unsupported') fallback();
			else if (status === 'retrying' && settled) close();
		};

		unlisten = await listen<BrokerMessage>(BROKER_EVENT, ({ payload }) => {
			if (payload.kind === 'state') {
				onState(payload.status);
				return;
			}
			if (!settled) connect();
			if (closed) return;
			try {
				controller?.enqueue(encoder.encode(payload.chunk));
			} catch {
				close();
			}
		});

		abort = () => {
			if (!settled) {
				settled = true;
				rejectResponse(new DOMException('Aborted', 'AbortError'));
			}
			close();
		};
		init.signal?.addEventListener('abort', abort, { once: true });
		if (init.signal?.aborted) {
			abort();
			return response;
		}
		try {
			const status = await invoke<BrokerStatus>('subscribe_desktop_events', {
				baseUrl: source.baseUrl,
				token: source.token,
				projectId: source.projectId,
				projectRoot: source.projectRoot,
				subscriptionId,
			});
			if (closed) unsubscribe();
			else onState(status.status);
		} catch (error) {
			if (!settled) {
				settled = true;
				unsubscribe();
				rejectResponse(error);
			}
		}

		return response;
	};
}
