#!/usr/bin/env bun
/**
 * Probe provider streaming latency directly (bypasses daemon, queue, and SSE).
 *
 * Measures, per provider/model:
 *   - ttfbMs:  request start -> first streamed part (network + provider queue)
 *   - totalMs: request start -> stream end
 *
 * Usage:
 *   bun run scripts/provider-latency.ts                    # config default provider/model
 *   bun run scripts/provider-latency.ts anthropic:claude-sonnet-4-5-20250929 openai:gpt-5-mini
 *   bun run scripts/provider-latency.ts --runs 3 anthropic:claude-sonnet-4-5-20250929
 *
 * If a probe here is fast while the app feels slow, the bottleneck is in the
 * daemon (event loop, DB writes, queue). If the probe is slow too, it's the
 * provider or the network.
 */
import { streamText } from 'ai';
import { loadConfig, type ProviderId } from '@ottocode/sdk';
import { resolveModel } from '../packages/server/src/runtime/provider/index.ts';

const PROBE_TIMEOUT_MS = 60_000;

interface ProbeResult {
	target: string;
	ok: boolean;
	ttftMs?: number;
	totalMs?: number;
	chunks?: number;
	chars?: number;
	error?: string;
}

function parseArgs(argv: string[]) {
	const targets: Array<{ provider: string; model: string }> = [];
	let runs = 1;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--runs') {
			runs = Math.max(1, Number(argv[++i]) || 1);
			continue;
		}
		const sep = arg.indexOf(':');
		if (sep > 0) {
			targets.push({
				provider: arg.slice(0, sep),
				model: arg.slice(sep + 1),
			});
		}
	}
	return { targets, runs };
}

async function probe(provider: string, modelId: string): Promise<ProbeResult> {
	const target = `${provider}:${modelId}`;
	const cfg = await loadConfig(process.cwd());
	const startedAt = performance.now();
	let ttftMs: number | undefined;
	let chunks = 0;
	let chars = 0;

	try {
		const model = await resolveModel(provider as ProviderId, modelId, cfg);
		// Match the runner: OpenAI OAuth (Codex backend) and Copilot reject
		// requests unless store is disabled.
		const providerOptions =
			provider === 'openai' || provider === 'copilot'
				? { openai: { store: false } }
				: undefined;
		const result = streamText({
			model,
			prompt: 'Reply with exactly: OK',
			providerOptions,
			abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		for await (const part of result.fullStream) {
			chunks += 1;
			if (
				(part.type === 'text-delta' || part.type === 'reasoning-delta') &&
				ttftMs === undefined
			) {
				ttftMs = performance.now() - startedAt;
			}
			if (part.type === 'text-delta' && typeof part.text === 'string') {
				chars += part.text.length;
			}
			if (part.type === 'error') {
				throw part.error instanceof Error
					? part.error
					: new Error(JSON.stringify(part.error).slice(0, 300));
			}
		}
		return {
			target,
			ok: true,
			ttftMs: Math.round(ttftMs ?? performance.now() - startedAt),
			totalMs: Math.round(performance.now() - startedAt),
			chunks,
			chars,
		};
	} catch (error) {
		return {
			target,
			ok: false,
			ttftMs: ttftMs === undefined ? undefined : Math.round(ttftMs),
			totalMs: Math.round(performance.now() - startedAt),
			error:
				error instanceof Error
					? error.message.slice(0, 300)
					: String(error).slice(0, 300),
		};
	}
}

async function main() {
	const { targets, runs } = parseArgs(process.argv.slice(2));

	if (targets.length === 0) {
		const cfg = await loadConfig(process.cwd());
		targets.push({
			provider: cfg.defaults.provider,
			model: cfg.defaults.model,
		});
	}

	console.log(
		`Probing ${targets.length} target(s), ${runs} run(s) each (direct provider call, no daemon)\n`,
	);

	for (const { provider, model } of targets) {
		for (let run = 1; run <= runs; run++) {
			const result = await probe(provider, model);
			const label =
				runs > 1 ? `${result.target} [${run}/${runs}]` : result.target;
			if (result.ok) {
				console.log(
					`  ${label}: first-token ${result.ttftMs}ms, total ${result.totalMs}ms, ${result.chunks} parts, ${result.chars} chars`,
				);
			} else {
				console.log(
					`  ${label}: FAILED after ${result.totalMs}ms${result.ttftMs !== undefined ? ` (first-token ${result.ttftMs}ms)` : ''} - ${result.error}`,
				);
			}
		}
	}
}

await main();
