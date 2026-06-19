import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
	DictationModelError,
	getDictationModelInstallPromise,
	getDictationModelState,
	requireDictationModel,
} from '../../dictation/models.ts';
import { encodeDictationEvent } from '../../dictation/protocol.ts';
import { DictationSessionError } from '../../dictation/sessions.ts';
import type { DictationServerEvent } from '../../dictation/types.ts';
import { toErrorMessage } from '../../runtime/errors/handling.ts';

export type WebSocketLike = {
	send: (data: string) => void;
	close: (code?: number, reason?: string) => void;
};

export function sessionResponse(sessionId: string, c: Context) {
	const url = new URL(c.req.url);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = `/v1/dictation/sessions/${encodeURIComponent(sessionId)}/ws`;
	url.search = '';
	return url.toString();
}

export function sendEvent(ws: WebSocketLike, event: DictationServerEvent) {
	try {
		ws.send(encodeDictationEvent(event));
	} catch {
		// Socket may already be closed.
	}
}

export function sendError(
	ws: WebSocketLike,
	code: DictationServerEvent extends infer Event
		? Event extends { type: 'error'; code: infer Code }
			? Code
			: never
		: never,
	message: string,
) {
	sendEvent(ws, { type: 'error', code, message });
}

export function toAudioFrame(data: unknown): Uint8Array | null {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	return null;
}

export function handleSessionError(ws: WebSocketLike, error: unknown) {
	if (error instanceof DictationSessionError) {
		sendError(ws, error.code, error.message);
		return;
	}
	sendError(ws, 'DICTATION_TRANSCRIBE_FAILED', toErrorMessage(error));
}

export function modelErrorResponse(c: Context, error: unknown) {
	if (error instanceof DictationModelError) {
		return c.json(
			{ error: error.message, code: error.code },
			error.status as ContentfulStatusCode,
		);
	}
	return c.json(
		{
			error: toErrorMessage(error),
			code: 'DICTATION_MODEL_DOWNLOAD_FAILED',
		},
		500,
	);
}

export async function streamModelInstallEvents(c: Context) {
	let model: ReturnType<typeof requireDictationModel>;
	try {
		model = requireDictationModel(c.req.param('model'));
	} catch (error) {
		return modelErrorResponse(c, error);
	}

	return streamSSE(c, async (stream) => {
		const sendState = async () => {
			const state = await getDictationModelState(model);
			await stream.write(
				`data: ${JSON.stringify({ type: 'model', model: state })}\n\n`,
			);
			return state;
		};

		let state = await sendState();
		while (state.installing && !c.req.raw.signal.aborted) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			state = await sendState();
		}

		await getDictationModelInstallPromise(model.id)?.catch(() => {});
		stream.close();
	});
}
