import { isDebugEnabled } from '../state.ts';
import { TurnDumpCollector } from './collector.ts';
import type { TurnDumpCollectorOptions } from './types.ts';

function isDumpEnabled(): boolean {
	return isDebugEnabled();
}

export function shouldDumpTurn(): boolean {
	return isDumpEnabled();
}

export function createTurnDumpCollector(
	opts: TurnDumpCollectorOptions,
): TurnDumpCollector | null {
	if (!shouldDumpTurn()) return null;
	return new TurnDumpCollector(opts);
}
