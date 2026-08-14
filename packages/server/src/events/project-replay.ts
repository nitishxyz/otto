import { projectScopeKey } from '../runtime/projects/scope.ts';
import { encodeSSEEvent } from './sse.ts';
import type { ClientEvent, OttoEvent } from './types.ts';

export const MAX_REPLAY_EVENTS_PER_KEY = 512;
export const MAX_REPLAY_BYTES_PER_KEY = 4 * 1024 * 1024;
const DESKTOP_REPLAY_KEY = '__desktop__';

export interface ProjectReplayRecord {
	id: string;
	sequence: number;
	kind: 'session' | 'client';
	sessionId: string | null;
	projectId?: string;
	projectRoot?: string;
	chunk: Uint8Array;
}

interface ReplayRing {
	records: ProjectReplayRecord[];
	bytes: number;
	evictedThroughSequence: number;
}

const rings = new Map<string, ReplayRing>();
let nextSequence = 1;
let replayedEvents = 0;
let replayMisses = 0;

function eventProjectKeys(event: OttoEvent): string[] {
	const keys = new Set<string>();
	if (event.projectId) keys.add(projectScopeKey(event.projectId));
	if (event.projectRoot) keys.add(projectScopeKey(event.projectRoot));
	if (keys.size === 0) keys.add(projectScopeKey(undefined));
	return [...keys];
}

function clientProjectKeys(event: ClientEvent): string[] {
	const payload = event.payload as { projectId?: string; projectRoot?: string };
	const keys = new Set<string>();
	if (payload.projectId) keys.add(projectScopeKey(payload.projectId));
	if (payload.projectRoot) keys.add(projectScopeKey(payload.projectRoot));
	if (keys.size === 0) keys.add(projectScopeKey(undefined));
	return [...keys];
}

function appendRecord(key: string, record: ProjectReplayRecord): void {
	let ring = rings.get(key);
	if (!ring) {
		ring = { records: [], bytes: 0, evictedThroughSequence: 0 };
		rings.set(key, ring);
	}
	ring.records.push(record);
	ring.bytes += record.chunk.byteLength;
	while (
		ring.records.length > MAX_REPLAY_EVENTS_PER_KEY ||
		ring.bytes > MAX_REPLAY_BYTES_PER_KEY
	) {
		const removed = ring.records.shift();
		if (!removed) break;
		ring.bytes -= removed.chunk.byteLength;
		ring.evictedThroughSequence = Math.max(
			ring.evictedThroughSequence,
			removed.sequence,
		);
	}
}

function createRecord(
	kind: ProjectReplayRecord['kind'],
	event: OttoEvent | ClientEvent,
): ProjectReplayRecord {
	const sequence = nextSequence++;
	const id = String(sequence);
	if (kind === 'session') {
		const sessionEvent = event as OttoEvent;
		return {
			id,
			sequence,
			kind,
			sessionId: sessionEvent.sessionId,
			projectId: sessionEvent.projectId,
			projectRoot: sessionEvent.projectRoot,
			chunk: encodeSSEEvent(
				sessionEvent.type,
				{
					sessionId: sessionEvent.sessionId,
					projectId: sessionEvent.projectId,
					projectRoot: sessionEvent.projectRoot,
					payload: sessionEvent.payload ?? {},
				},
				id,
			),
		};
	}
	const clientEvent = event as ClientEvent;
	const payload = clientEvent.payload as {
		projectId?: string;
		projectRoot?: string;
	};
	return {
		id,
		sequence,
		kind,
		sessionId: null,
		projectId: payload.projectId,
		projectRoot: payload.projectRoot,
		chunk: encodeSSEEvent(
			clientEvent.type,
			{
				projectId: payload.projectId,
				projectRoot: payload.projectRoot,
				payload: clientEvent.payload ?? {},
			},
			id,
		),
	};
}

export function recordProjectSessionEvent(
	event: OttoEvent,
): ProjectReplayRecord {
	const record = createRecord('session', event);
	appendRecord(DESKTOP_REPLAY_KEY, record);
	for (const key of eventProjectKeys(event)) appendRecord(key, record);
	return record;
}

export function recordProjectClientEvent(
	event: ClientEvent,
): ProjectReplayRecord {
	const record = createRecord('client', event);
	appendRecord(DESKTOP_REPLAY_KEY, record);
	for (const key of clientProjectKeys(event)) appendRecord(key, record);
	return record;
}

/** Returns daemon-wide replay records for the native desktop event broker. */
export function getDesktopReplay(lastEventId: string): {
	records: ProjectReplayRecord[];
	missed: boolean;
} {
	const sequence = Number.parseInt(lastEventId, 10);
	const ring = rings.get(DESKTOP_REPLAY_KEY);
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		replayMisses += 1;
		return { records: [], missed: true };
	}
	if (!ring) return { records: [], missed: false };
	const missed = ring.evictedThroughSequence > sequence;
	const records = ring.records.filter((record) => record.sequence > sequence);
	replayedEvents += records.length;
	if (missed) replayMisses += 1;
	return { records, missed };
}

export function getProjectReplay(
	projectKeys: Array<string | undefined>,
	lastEventId: string,
): { records: ProjectReplayRecord[]; missed: boolean } {
	const sequence = Number.parseInt(lastEventId, 10);
	const keys = new Set(projectKeys.map((key) => projectScopeKey(key)));
	const selectedRings = [...keys].flatMap((key) => {
		const ring = rings.get(key);
		return ring ? [ring] : [];
	});
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		replayMisses += 1;
		return { records: [], missed: true };
	}
	const byId = new Map<string, ProjectReplayRecord>();
	let missed = false;
	for (const ring of selectedRings) {
		if (ring.evictedThroughSequence > sequence) missed = true;
		for (const record of ring.records) {
			if (record.sequence > sequence) byId.set(record.id, record);
		}
	}
	const records = [...byId.values()].sort(
		(left, right) => left.sequence - right.sequence,
	);
	replayedEvents += records.length;
	if (missed) replayMisses += 1;
	return { records, missed };
}

export interface ProjectReplayStats {
	keys: number;
	events: number;
	bytes: number;
	replayedEvents: number;
	replayMisses: number;
}

export function getProjectReplayStats(): ProjectReplayStats {
	let events = 0;
	let bytes = 0;
	for (const ring of rings.values()) {
		events += ring.records.length;
		bytes += ring.bytes;
	}
	return {
		keys: rings.size,
		events,
		bytes,
		replayedEvents,
		replayMisses,
	};
}
