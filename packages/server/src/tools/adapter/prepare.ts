import type { Tool } from 'ai';
import { getToolMetadata } from '@ottocode/sdk';
import {
	resolvePolicyPath,
	toExecutionPath,
} from '@ottocode/sdk/tools/builtin/fs';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import {
	requiresApproval,
	skipsGuardApproval,
} from '../../runtime/tools/approval.ts';
import { getToolPathFields } from '../../runtime/tools/definitions.ts';
import { guardToolCall } from '../../runtime/tools/guards.ts';
import { getCwd } from '../../runtime/utils/cwd.ts';
import { resolveForgePluginToolExecutionEffects } from '../../runtime/forge/plugin-tool.ts';
import type { ForgeInput } from '../../runtime/forge/types.ts';

export type PreparedToolCall =
	| {
			kind: 'ready';
			/** Arguments the tool executes with (paths resolved once). */
			executionArgs: unknown;
			needsApproval: boolean;
			approvalReason?: string;
	  }
	| { kind: 'blocked'; reason: string }
	| { kind: 'invalid'; error: string };

export type PathResolutionInput = {
	projectRoot: string;
	readOnlyRoots?: string[];
	/** Session cwd (project-relative or absolute). */
	cwd?: string;
};

/**
 * Rewrites the tool's declared path fields to their resolved execution
 * form. Relative results are always project-relative, so the rewritten
 * arguments no longer depend on the session cwd.
 */
export function resolveToolExecutionArgs(
	name: string,
	input: unknown,
	context: PathResolutionInput,
): { args: unknown } | { error: string } {
	const fields = getToolPathFields(name, input);
	if (!fields.length || !input || typeof input !== 'object') {
		return { args: input };
	}
	const next: Record<string, unknown> = {
		...(input as Record<string, unknown>),
	};
	for (const field of fields) {
		const value = next[field.field];
		const raw = typeof value === 'string' ? value.trim() : '';
		const useSessionDefault =
			field.sessionDefault && (value === undefined || !raw || raw === '.');
		if (!useSessionDefault && !raw) continue;
		const resolved = resolvePolicyPath(
			useSessionDefault ? '.' : raw,
			{
				projectRoot: context.projectRoot,
				cwd: context.cwd,
				readOnlyRoots: context.readOnlyRoots,
			},
			{
				base:
					field.base === 'session' || useSessionDefault ? 'session' : 'project',
			},
		);
		if (name === 'cd') {
			if (!resolved.exists || !resolved.isDirectory) {
				return { error: `Directory not found: ${raw}` };
			}
			if (resolved.scope === 'outside') {
				return {
					error: `Cannot cd outside the project or reference directories: ${raw}`,
				};
			}
		}
		next[field.field] = toExecutionPath(resolved);
	}
	return { args: next };
}

/**
 * Resolves paths, then evaluates guards and approval policy on the resolved
 * arguments. Blocked or invalid calls never request approval, and at most
 * one approval is needed for an executable call.
 */
export async function prepareToolCall(args: {
	base: Tool;
	ctx: ToolAdapterContext;
	name: string;
	input: unknown;
}): Promise<PreparedToolCall> {
	const { ctx, name } = args;
	const resolution = resolveToolExecutionArgs(name, args.input, {
		projectRoot: ctx.projectRoot,
		readOnlyRoots: ctx.readOnlyRoots,
		cwd: getCwd(ctx.sessionId),
	});
	if ('error' in resolution) {
		return { kind: 'invalid', error: resolution.error };
	}
	const executionArgs = resolution.args;
	if (name === 'progress_update') {
		return { kind: 'ready', executionArgs, needsApproval: false };
	}

	const guard = guardToolCall(name, executionArgs, {
		projectRoot: ctx.projectRoot,
		readOnlyRoots: ctx.readOnlyRoots,
	});
	if (guard.type === 'block') {
		return { kind: 'blocked', reason: guard.reason };
	}
	const effects =
		name === 'forge'
			? await resolveForgePluginToolExecutionEffects(
					ctx.projectRoot,
					executionArgs as ForgeInput,
				)
			: getToolMetadata(args.base)?.effects;

	const modeRequiresApproval = Boolean(
		ctx.toolApprovalMode &&
			requiresApproval(name, ctx.toolApprovalMode, executionArgs, effects),
	);
	const guardRequiresApproval =
		guard.type === 'approve' && !skipsGuardApproval(ctx.toolApprovalMode);
	return {
		kind: 'ready',
		executionArgs,
		needsApproval: modeRequiresApproval || guardRequiresApproval,
		approvalReason: guard.type === 'approve' ? guard.reason : undefined,
	};
}
