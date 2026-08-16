export type DesktopTerminalBackend = 'wasm' | 'native';

export function selectDesktopTerminalBackend(
	officialWasmInitializationFailed: boolean,
): DesktopTerminalBackend {
	return officialWasmInitializationFailed ? 'native' : 'wasm';
}
