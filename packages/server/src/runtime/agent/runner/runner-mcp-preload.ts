import {
	createJudge,
	logger,
	resolveJudgeConfig,
	selectMCPToolsForRequest,
	type MCPPreloadResult,
	type MCPToolBrief,
	type OttoConfig,
} from '@ottocode/sdk';
import type { RunOpts } from '../../session/queue.ts';

/** Hard cap so a slow judge can never delay the first model call noticeably. */
const PRELOAD_TIMEOUT_MS = 1_500;

export type MCPPreloadHandle = {
	/** Resolves to the judge's selection, or null when preloading is off/failed. */
	result: Promise<MCPPreloadResult | null>;
};

/**
 * Kick off MCP tool pre-selection for this turn without blocking. Callers
 * await `result` only at the point where the lazy loader is assembled, so the
 * judge call overlaps prompt composition and model resolution.
 */
export function startMCPPreload(args: {
	opts: RunOpts;
	cfg: OttoConfig;
	briefs: MCPToolBrief[];
}): MCPPreloadHandle {
	const { opts, cfg, briefs } = args;
	if (briefs.length === 0 || opts.omitHistory || opts.isCompactCommand) {
		return { result: Promise.resolve(null) };
	}
	const userMessage = opts.userContent?.trim() ?? '';
	if (!userMessage) return { result: Promise.resolve(null) };

	const result = (async (): Promise<MCPPreloadResult | null> => {
		try {
			const config = await resolveJudgeConfig(cfg.judge, cfg.projectRoot);
			if (!config.mcp.preloadTools) return null;
			const judge = await createJudge({
				settings: cfg.judge,
				projectRoot: cfg.projectRoot,
			});
			if (!judge) return null;
			const selection = await selectMCPToolsForRequest(
				{ userMessage, briefs },
				{
					judge,
					threshold: config.mcp.preloadThreshold,
					timeoutMs: Math.min(PRELOAD_TIMEOUT_MS, config.timeoutMs),
				},
			);
			logger.debug('[mcp] preload selection', {
				sessionId: opts.sessionId,
				candidates: briefs.length,
				selected: selection.selected,
				skipped: selection.skipped,
			});
			return selection;
		} catch (error) {
			logger.debug('[mcp] preload failed', {
				sessionId: opts.sessionId,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	})();

	return { result };
}
