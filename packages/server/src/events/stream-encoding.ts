import { createSSEEncodingCache, encodeSSEEvent } from './sse.ts';
import type { ClientEvent, OttoEvent } from './types.ts';

export const encodeSessionStreamEvent = createSSEEncodingCache(
	(event: OttoEvent) => encodeSSEEvent(event.type, event.payload ?? {}),
);

export const encodeClientStreamEvent = createSSEEncodingCache(
	(event: ClientEvent) => encodeSSEEvent(event.type, event.payload ?? {}),
);
