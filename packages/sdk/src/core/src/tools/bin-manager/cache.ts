const resolvedPaths = new Map<string, string>();

export function getCachedBinary(name: string): string | undefined {
	return resolvedPaths.get(name);
}

export function setCachedBinary(name: string, path: string): void {
	resolvedPaths.set(name, path);
}

export function clearCachedBinaries(): void {
	resolvedPaths.clear();
}
