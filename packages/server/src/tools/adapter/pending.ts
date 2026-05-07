export type PendingCallMeta = {
	callId: string;
	startTs: number;
	stepIndex?: number;
	args?: unknown;
	approvalPromise?: Promise<boolean>;
	blocked?: boolean;
	blockReason?: string;
};

export function getPendingQueue(
	map: Map<string, PendingCallMeta[]>,
	name: string,
): PendingCallMeta[] {
	let queue = map.get(name);
	if (!queue) {
		queue = [];
		map.set(name, queue);
	}
	return queue;
}

export function shiftPendingCall(
	map: Map<string, PendingCallMeta[]>,
	name: string,
): PendingCallMeta | undefined {
	const queue = map.get(name);
	const meta = queue?.shift();
	if (queue && queue.length === 0) {
		map.delete(name);
	}
	return meta;
}

export function extractToolCallId(options: unknown): string | undefined {
	return (options as { toolCallId?: string } | undefined)?.toolCallId;
}
