const NON_DELEGATABLE_AGENTS = new Set(['general', 'looper']);

export function isDelegatableAgent(name: string): boolean {
	return !NON_DELEGATABLE_AGENTS.has(name);
}
