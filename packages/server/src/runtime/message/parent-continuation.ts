import { and, eq, ne } from 'drizzle-orm';
import { subagents } from '@ottocode/database/schema';
import { acceptUserTurn } from './create.ts';
import type { DispatchOptions, TurnClaim, TurnTransaction } from './types.ts';

type SubagentRow = typeof subagents.$inferSelect;

/** Exact version of a finished sub-agent result the caller rendered. */
export type SubagentResultClaim = Pick<
	SubagentRow,
	'id' | 'status' | 'attemptSeq' | 'updatedAt'
>;

/** Thrown inside the turn transaction when any claimed result changed. */
export class SubagentResultClaimConflictError extends Error {
	readonly staleIds: string[];

	constructor(staleIds: string[]) {
		super(`Sub-agent results changed before delivery: ${staleIds.join(', ')}`);
		this.name = 'SubagentResultClaimConflictError';
		this.staleIds = staleIds;
	}
}

/**
 * Marks every claimed result delivered under `deliveryKey`, compare-and-set
 * against the rendered version (status, attemptSeq, updatedAt) and requiring
 * `delivery_state = 'pending'` under `parentSessionId`. All-or-nothing: if any
 * claim is stale it throws SubagentResultClaimConflictError, which rolls back
 * the enclosing transaction. Does not bump `updatedAt`.
 */
export function claimSubagentResults(
	tx: TurnTransaction,
	args: {
		parentSessionId: string;
		deliveryKey: string;
		claims: readonly SubagentResultClaim[];
	},
): string[] {
	const stale: string[] = [];
	for (const claim of args.claims) {
		const row = tx
			.update(subagents)
			.set({
				reported: true,
				deliveryState: 'delivered',
				deliveryKey: args.deliveryKey,
			})
			.where(
				and(
					eq(subagents.id, claim.id),
					eq(subagents.parentSessionId, args.parentSessionId),
					ne(subagents.status, 'running'),
					eq(subagents.status, claim.status),
					eq(subagents.attemptSeq, claim.attemptSeq),
					eq(subagents.updatedAt, claim.updatedAt),
					eq(subagents.deliveryState, 'pending'),
				),
			)
			.returning({ id: subagents.id })
			.get();
		if (!row) stale.push(claim.id);
	}
	if (stale.length > 0) throw new SubagentResultClaimConflictError(stale);
	return args.claims.map((claim) => claim.id);
}

/** TurnClaim for `DispatchOptions.acceptClaim` / `acceptUserTurn({ claim })`. */
export function subagentResultsTurnClaim(args: {
	parentSessionId: string;
	deliveryKey: string;
	claims: readonly SubagentResultClaim[];
}): TurnClaim {
	return (tx) => {
		claimSubagentResults(tx, args);
	};
}

export type AcceptParentContinuationResult =
	| {
			ok: true;
			userMessageId: string;
			assistantMessageId: string;
			contextTokens: number;
			claimedIds: string[];
	  }
	| { ok: false; reason: 'stale'; staleIds: string[] };

/**
 * Persists a parent continuation turn (user message + pending assistant) and
 * claims the rendered sub-agent results in one transaction. On a stale claim
 * nothing is written and `{ ok: false, staleIds }` is returned so the caller
 * can re-read and re-render. Does not enqueue a run; callers that want the
 * full dispatch pipeline pass `subagentResultsTurnClaim(...)` as
 * `dispatchAssistantMessage({ acceptClaim })` instead.
 */
export async function acceptParentContinuation(args: {
	db: DispatchOptions['db'];
	parentSessionId: string;
	agent: string;
	provider: DispatchOptions['provider'];
	model: string;
	content: string;
	messageOrigin?: DispatchOptions['messageOrigin'];
	deliveryKey: string;
	claims: readonly SubagentResultClaim[];
	createdAt?: number;
}): Promise<AcceptParentContinuationResult> {
	try {
		const accepted = await acceptUserTurn({
			db: args.db,
			sessionId: args.parentSessionId,
			agent: args.agent,
			provider: args.provider,
			model: args.model,
			content: args.content,
			messageOrigin: args.messageOrigin ?? 'agent-results',
			createdAt: args.createdAt ?? Date.now(),
			claim: subagentResultsTurnClaim(args),
		});
		return {
			ok: true,
			...accepted,
			claimedIds: args.claims.map((claim) => claim.id),
		};
	} catch (error) {
		if (error instanceof SubagentResultClaimConflictError) {
			return { ok: false, reason: 'stale', staleIds: error.staleIds };
		}
		throw error;
	}
}
