/**
 * Teardown for the Web Audio graph behind dictation.
 *
 * A live `AudioContext` that reached `destination` keeps a real-time audio
 * render thread (and the microphone stream) alive for the whole lifetime of the
 * page, so every abandoned context is a permanent leak. `start()` can be
 * superseded or cancelled at several `await` points *after* the graph is
 * already wired, which is why disposal is expressed over plain locals here
 * rather than over the hook's refs.
 */

interface TrackLike {
	stop: () => void;
}

export interface MediaStreamLike {
	getTracks: () => TrackLike[];
}

export interface AudioNodeLike {
	disconnect: () => void;
}

export interface ScriptProcessorLike extends AudioNodeLike {
	onaudioprocess: unknown;
}

export interface AudioContextLike {
	readonly state: string;
	close: () => Promise<void>;
}

export interface VoiceSessionResources {
	stream?: MediaStreamLike | null;
	source?: AudioNodeLike | null;
	processor?: ScriptProcessorLike | null;
	context?: AudioContextLike | null;
}

/**
 * Releases every resource in `resources`, tolerating partially-constructed
 * graphs and already-closed contexts. Each step is isolated so one throwing
 * node cannot strand the `AudioContext` that follows it.
 */
export function disposeVoiceSessionResources(
	resources: VoiceSessionResources,
): void {
	const { stream, source, processor, context } = resources;

	if (processor) {
		try {
			processor.onaudioprocess = null;
			processor.disconnect();
		} catch {
			// A disconnected node throws on some engines; disposal continues.
		}
	}

	if (source) {
		try {
			source.disconnect();
		} catch {
			// Ignore: the node may already be detached.
		}
	}

	if (stream) {
		try {
			for (const track of stream.getTracks()) track.stop();
		} catch {
			// Ignore: an ended track can throw on stop().
		}
	}

	// Closing is what releases the audio render thread, so it must run even
	// when an earlier step failed.
	if (context && context.state !== 'closed') {
		try {
			void context.close().catch(() => {});
		} catch {
			// Ignore: closing twice is harmless.
		}
	}
}
