import { publish } from '../../events/bus.ts';

export type ShellJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type ShellJobSnapshot = {
	id: string;
	projectRoot?: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	command: string;
	cwd: string;
	status: ShellJobStatus;
	detached: boolean;
	output: string;
	exitCode: number | null;
	result: unknown;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
};

type ActiveShellProcess = ShellJobSnapshot & {
	abort: () => void;
	onDetach: (jobId: string) => void;
	onDetachedCompletion?: (sessionId: string, projectRoot?: string) => void;
	reporting: boolean;
};

export type ActiveShellRegistration = {
	jobId: string;
	appendOutput: (text: string) => void;
	detach: () => boolean;
	complete: (args: {
		status: Exclude<ShellJobStatus, 'running'>;
		result: unknown;
		exitCode?: number | null;
	}) => void;
	unregister: () => void;
};

const activeShells = new Map<string, ActiveShellProcess>();
const MAX_LIVE_OUTPUT_CHARS = 1024 * 1024;
const RETENTION_MS = 30 * 60 * 1000;

function toSnapshot(entry: ActiveShellProcess): ShellJobSnapshot {
	const {
		abort: _abort,
		onDetach: _onDetach,
		onDetachedCompletion: _notify,
		reporting: _reporting,
		...snapshot
	} = entry;
	return { ...snapshot };
}

function publishJobUpdated(entry: ActiveShellProcess): void {
	publish({
		type: 'shell.job.updated',
		sessionId: entry.sessionId,
		projectRoot: entry.projectRoot,
		payload: { job: toSnapshot(entry) },
	});
}

function publishJobOutput(entry: ActiveShellProcess, delta: string): void {
	publish({
		type: 'shell.job.output',
		sessionId: entry.sessionId,
		projectRoot: entry.projectRoot,
		payload: { jobId: entry.id, delta, updatedAt: entry.updatedAt },
	});
}

function pruneExpiredShellJobs(now = Date.now()): void {
	for (const [id, entry] of activeShells) {
		if (
			entry.status !== 'running' &&
			entry.completedAt !== null &&
			now - entry.completedAt > RETENTION_MS
		) {
			activeShells.delete(id);
		}
	}
}

export function registerActiveShellProcess(args: {
	projectRoot?: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	command: string;
	cwd: string;
	abort: () => void;
	onDetach: (jobId: string) => void;
	onDetachedCompletion?: (sessionId: string, projectRoot?: string) => void;
}): ActiveShellRegistration {
	pruneExpiredShellJobs();
	const now = Date.now();
	const jobId = crypto.randomUUID();
	const entry: ActiveShellProcess = {
		id: jobId,
		projectRoot: args.projectRoot,
		sessionId: args.sessionId,
		messageId: args.messageId,
		callId: args.callId,
		command: args.command,
		cwd: args.cwd,
		status: 'running',
		detached: false,
		output: '',
		exitCode: null,
		result: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
		completedAt: null,
		abort: args.abort,
		onDetach: args.onDetach,
		onDetachedCompletion: args.onDetachedCompletion,
		reporting: false,
	};
	activeShells.set(jobId, entry);
	publishJobUpdated(entry);

	const detach = () => {
		if (entry.status !== 'running' || entry.detached) return false;
		entry.detached = true;
		entry.updatedAt = Date.now();
		entry.onDetach(jobId);
		publishJobUpdated(entry);
		return true;
	};

	return {
		jobId,
		appendOutput(text) {
			if (!text || entry.status !== 'running') return;
			entry.output = `${entry.output}${text}`.slice(-MAX_LIVE_OUTPUT_CHARS);
			entry.updatedAt = Date.now();
			publishJobOutput(entry, text);
		},
		detach,
		complete({ status, result, exitCode = null }) {
			if (entry.status !== 'running') return;
			entry.status = status;
			entry.result = result;
			entry.exitCode = exitCode;
			entry.updatedAt = Date.now();
			entry.completedAt = entry.updatedAt;
			publishJobUpdated(entry);
			if (!entry.detached) {
				activeShells.delete(jobId);
				return;
			}
			entry.onDetachedCompletion?.(entry.sessionId, entry.projectRoot);
			const timer = setTimeout(() => activeShells.delete(jobId), RETENTION_MS);
			timer.unref?.();
		},
		unregister() {
			activeShells.delete(jobId);
		},
	};
}

export function listShellJobsForSession(
	sessionId: string,
	projectRoot?: string,
): ShellJobSnapshot[] {
	pruneExpiredShellJobs();
	return Array.from(activeShells.values())
		.filter(
			(entry) =>
				entry.sessionId === sessionId &&
				(projectRoot === undefined || entry.projectRoot === projectRoot),
		)
		.sort((a, b) => b.createdAt - a.createdAt)
		.map(toSnapshot);
}

export function detachActiveShellJob(
	jobId: string,
	sessionId: string,
	projectRoot?: string,
): ShellJobSnapshot | null {
	const entry = activeShells.get(jobId);
	if (
		!entry ||
		entry.sessionId !== sessionId ||
		(projectRoot !== undefined && entry.projectRoot !== projectRoot)
	)
		return null;
	if (entry.status === 'running' && !entry.detached) {
		entry.detached = true;
		entry.updatedAt = Date.now();
		entry.onDetach(jobId);
		publishJobUpdated(entry);
	}
	return toSnapshot(entry);
}

export function abortActiveShellJob(
	jobId: string,
	sessionId: string,
	projectRoot?: string,
): ShellJobSnapshot | null {
	const entry = activeShells.get(jobId);
	if (
		!entry ||
		entry.sessionId !== sessionId ||
		(projectRoot !== undefined && entry.projectRoot !== projectRoot)
	)
		return null;
	if (entry.status === 'running') entry.abort();
	return toSnapshot(entry);
}

export function claimFinishedShellJobs(sessionId: string): ShellJobSnapshot[] {
	const claimed: ShellJobSnapshot[] = [];
	for (const entry of activeShells.values()) {
		if (
			entry.sessionId !== sessionId ||
			!entry.detached ||
			entry.status === 'running' ||
			entry.reported ||
			entry.reporting
		)
			continue;
		entry.reporting = true;
		claimed.push(toSnapshot(entry));
	}
	return claimed.sort((a, b) => a.createdAt - b.createdAt);
}

export function markShellJobsReported(jobIds: string[]): void {
	for (const id of jobIds) {
		const entry = activeShells.get(id);
		if (!entry) continue;
		entry.reporting = false;
		entry.reported = true;
		entry.updatedAt = Date.now();
	}
}

export function releaseClaimedShellJobs(jobIds: string[]): void {
	for (const id of jobIds) {
		const entry = activeShells.get(id);
		if (entry) entry.reporting = false;
	}
}

export function abortActiveShellsForMessage(
	sessionId: string,
	messageId: string,
	projectRoot?: string,
): number {
	let count = 0;
	for (const entry of activeShells.values()) {
		if (
			entry.detached ||
			entry.status !== 'running' ||
			entry.sessionId !== sessionId ||
			entry.messageId !== messageId ||
			entry.projectRoot !== projectRoot
		)
			continue;
		count++;
		entry.abort();
	}
	return count;
}

export function abortActiveShellsForSession(
	sessionId: string,
	projectRoot?: string,
): number {
	let count = 0;
	for (const entry of activeShells.values()) {
		if (
			entry.detached ||
			entry.status !== 'running' ||
			entry.sessionId !== sessionId ||
			entry.projectRoot !== projectRoot
		)
			continue;
		count++;
		entry.abort();
	}
	return count;
}
