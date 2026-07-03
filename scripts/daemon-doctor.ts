#!/usr/bin/env bun
/**
 * Daemon runtime diagnostics snapshot tool.
 *
 * Usage:
 *   bun run scripts/daemon-doctor.ts            # take a snapshot
 *   bun run scripts/daemon-doctor.ts --baseline # save snapshot as healthy baseline
 *   bun run scripts/daemon-doctor.ts --compare  # snapshot + diff against baseline
 *
 * Snapshots are written to ~/.otto/diagnostics/.
 */

import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OTTO_HOME = process.env.OTTO_HOME || join(homedir(), '.otto');
const DIAG_DIR = join(OTTO_HOME, 'diagnostics');
const BASELINE_PATH = join(DIAG_DIR, 'baseline.json');

interface Registration {
	id?: string;
	port?: number;
	pid?: number;
}

interface RuntimeStats {
	pid: number;
	uptimeSeconds: number;
	memory: {
		rssMb: number;
		heapUsedMb: number;
		heapTotalMb: number;
		externalMb?: number;
		arrayBuffersMb?: number;
	};
	bus: {
		sessionKeys: number;
		sessionSubscribers: number;
		clientSubscribers: number;
		topSessionKeys: Array<{ key: string; subscribers: number }>;
	};
	queue: {
		runnerStates: number;
		runningRunners: number;
		queuedMessages: number;
		messageAbortControllers: number;
	};
	projects: {
		open: number;
		items: Array<{ id: string; name: string; lastUsedAt: number }>;
	};
}

interface Snapshot {
	takenAt: string;
	port: number;
	tcpSockets: number | null;
	tcpEstablished: number | null;
	runtime: RuntimeStats;
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return (await Bun.file(path).json()) as T;
	} catch {
		return null;
	}
}

async function readToken(): Promise<string | null> {
	try {
		const text = (
			await Bun.file(join(OTTO_HOME, 'server-token')).text()
		).trim();
		return text || null;
	} catch {
		return null;
	}
}

async function countSockets(
	pid: number,
): Promise<{ total: number; established: number } | null> {
	try {
		const proc = Bun.spawn(['lsof', '-nP', '-p', String(pid)], {
			stdout: 'pipe',
			stderr: 'ignore',
		});
		const out = await new Response(proc.stdout).text();
		const lines = out.split('\n').filter((line) => line.includes('TCP'));
		return {
			total: lines.length,
			established: lines.filter((line) => line.includes('ESTABLISHED')).length,
		};
	} catch {
		return null;
	}
}

function fmtDelta(before: number, after: number, invertBad = false): string {
	const delta = after - before;
	const sign = delta > 0 ? '+' : '';
	const grew = invertBad ? delta < 0 : delta > 0;
	const marker = delta === 0 ? '' : grew ? '  ⚠️' : '';
	return `${before} -> ${after} (${sign}${delta})${marker}`;
}

function analyze(baseline: Snapshot, current: Snapshot): string[] {
	const notes: string[] = [];
	const b = baseline.runtime;
	const c = current.runtime;

	if (c.bus.sessionSubscribers > b.bus.sessionSubscribers + 10) {
		notes.push(
			'SSE session subscribers grew significantly: likely server-side subscriber leak (stream cleanup not firing).',
		);
	}
	const topKey = c.bus.topSessionKeys[0];
	if (topKey && topKey.subscribers > 6) {
		notes.push(
			`Session key "${topKey.key}" has ${topKey.subscribers} subscribers: one client is stacking connections (reconnect loop not replacing old streams).`,
		);
	}
	if (
		c.memory.rssMb > b.memory.rssMb * 2 &&
		c.bus.sessionSubscribers <= b.bus.sessionSubscribers + 10
	) {
		notes.push(
			'RSS grew heavily but subscriber counts are stable: data buffering into dead streams or another memory leak.',
		);
	}
	if (c.queue.messageAbortControllers > b.queue.messageAbortControllers + 10) {
		notes.push(
			'Message abort controllers accumulating: runner cleanup leak in session queue.',
		);
	}
	if (c.queue.runnerStates > b.queue.runnerStates + 20) {
		notes.push(
			'Runner states accumulating: deleteRunnerState not being called.',
		);
	}
	if (
		current.tcpSockets !== null &&
		c.bus.sessionSubscribers + c.bus.clientSubscribers + 10 < current.tcpSockets
	) {
		notes.push(
			'OS-level TCP sockets far exceed bus subscribers: connections dying without cleanup running.',
		);
	}
	if (notes.length === 0) {
		notes.push(
			'No obvious leak pattern in counters. If requests still hang, suspect event-loop blockage: run `sample <pid> 5` while degraded.',
		);
	}
	return notes;
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const isBaseline = args.has('--baseline');
	const isCompare = args.has('--compare');

	const registration = await readJson<Registration>(
		join(OTTO_HOME, 'server.json'),
	);
	const port =
		registration?.port ??
		Number.parseInt(process.env.OTTO_DAEMON_PORT || '47477', 10);
	const token = await readToken();

	const headers: Record<string, string> = token
		? { Authorization: `Bearer ${token}`, 'X-Otto-Server-Token': token }
		: {};

	let runtime: RuntimeStats;
	try {
		const response = await fetch(`http://127.0.0.1:${port}/v1/debug/runtime`, {
			headers,
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) {
			console.error(
				`Daemon responded ${response.status} on port ${port}. Is it running an up-to-date build with /v1/debug/runtime?`,
			);
			process.exit(1);
		}
		runtime = (await response.json()) as RuntimeStats;
	} catch (error) {
		console.error(
			`Could not reach daemon on port ${port}: ${error instanceof Error ? error.message : String(error)}`,
		);
		console.error(
			'If the request timed out, the event loop may be blocked. Run: sample <daemon-pid> 5',
		);
		process.exit(1);
	}

	const sockets = await countSockets(runtime.pid);

	const snapshot: Snapshot = {
		takenAt: new Date().toISOString(),
		port,
		tcpSockets: sockets?.total ?? null,
		tcpEstablished: sockets?.established ?? null,
		runtime,
	};

	await mkdir(DIAG_DIR, { recursive: true });
	const stamp = snapshot.takenAt.replace(/[:.]/g, '-');
	const snapshotPath = join(DIAG_DIR, `snapshot-${stamp}.json`);
	await Bun.write(snapshotPath, JSON.stringify(snapshot, null, 2));

	if (isBaseline) {
		await Bun.write(BASELINE_PATH, JSON.stringify(snapshot, null, 2));
	}

	console.log(`Daemon pid ${runtime.pid} on port ${port}`);
	console.log(
		`  uptime: ${Math.floor(runtime.uptimeSeconds / 3600)}h ${Math.floor((runtime.uptimeSeconds % 3600) / 60)}m`,
	);
	console.log(
		`  memory: rss ${runtime.memory.rssMb}MB, heap ${runtime.memory.heapUsedMb}/${runtime.memory.heapTotalMb}MB, external ${runtime.memory.externalMb ?? 'n/a'}MB, arrayBuffers ${runtime.memory.arrayBuffersMb ?? 'n/a'}MB`,
	);
	console.log(
		`  bus: ${runtime.bus.sessionSubscribers} session subs across ${runtime.bus.sessionKeys} keys, ${runtime.bus.clientSubscribers} client subs`,
	);
	console.log(
		`  queue: ${runtime.queue.runnerStates} runners (${runtime.queue.runningRunners} running), ${runtime.queue.queuedMessages} queued, ${runtime.queue.messageAbortControllers} abort controllers`,
	);
	console.log(
		`  tcp: ${snapshot.tcpSockets ?? 'n/a'} sockets (${snapshot.tcpEstablished ?? 'n/a'} established)`,
	);
	console.log(`  projects open: ${runtime.projects.open}`);
	console.log(`\nSnapshot saved: ${snapshotPath}`);
	if (isBaseline) console.log(`Baseline saved: ${BASELINE_PATH}`);

	if (isCompare || (!isBaseline && (await Bun.file(BASELINE_PATH).exists()))) {
		const baseline = await readJson<Snapshot>(BASELINE_PATH);
		if (!baseline) {
			console.log('\nNo baseline found. Run with --baseline when healthy.');
			return;
		}
		const b = baseline.runtime;
		const c = runtime;
		console.log(`\nCompared to baseline (${baseline.takenAt}):`);
		console.log(
			`  rss MB:            ${fmtDelta(b.memory.rssMb, c.memory.rssMb)}`,
		);
		console.log(
			`  session subs:      ${fmtDelta(b.bus.sessionSubscribers, c.bus.sessionSubscribers)}`,
		);
		console.log(
			`  client subs:       ${fmtDelta(b.bus.clientSubscribers, c.bus.clientSubscribers)}`,
		);
		console.log(
			`  runner states:     ${fmtDelta(b.queue.runnerStates, c.queue.runnerStates)}`,
		);
		console.log(
			`  abort controllers: ${fmtDelta(b.queue.messageAbortControllers, c.queue.messageAbortControllers)}`,
		);
		console.log(
			`  tcp sockets:       ${fmtDelta(baseline.tcpSockets ?? 0, snapshot.tcpSockets ?? 0)}`,
		);
		if (c.bus.topSessionKeys.length > 0) {
			console.log('  top session keys:');
			for (const entry of c.bus.topSessionKeys.slice(0, 5)) {
				console.log(`    ${entry.subscribers}x ${entry.key}`);
			}
		}
		console.log('\nAnalysis:');
		for (const note of analyze(baseline, snapshot)) {
			console.log(`  - ${note}`);
		}
	}

	const snapshots = (await readdir(DIAG_DIR)).filter((f) =>
		f.startsWith('snapshot-'),
	);
	if (snapshots.length > 50) {
		console.log(
			`\nNote: ${snapshots.length} snapshots in ${DIAG_DIR} — consider cleaning old ones.`,
		);
	}
}

await main();
