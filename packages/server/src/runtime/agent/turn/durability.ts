import { ToolResultDurabilityError } from '@ottocode/sdk/tools/error';

/** Finds durability failures through SDK error/cause and step-content wrappers. */
export function findToolResultDurabilityError(
	value: unknown,
): unknown | undefined {
	const pending: unknown[] = [value];
	const visited = new Set<object>();
	for (let count = 0; pending.length && count < 256; count++) {
		const current = pending.pop();
		if (!current || typeof current !== 'object' || visited.has(current))
			continue;
		visited.add(current);
		const record = current as Record<string, unknown>;
		if (
			current instanceof ToolResultDurabilityError ||
			record.code === 'TOOL_RESULT_DURABILITY_FAILED'
		)
			return current;
		if (Array.isArray(current)) pending.push(...current);
		else
			for (const key of ['cause', 'error', 'content', 'toolResults', 'steps'])
				pending.push(record[key]);
	}
	return undefined;
}
