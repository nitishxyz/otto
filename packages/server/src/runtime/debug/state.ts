/**
 * Runtime debug state management
 *
 * Centralizes debug flag state that can be set either via:
 * - Runtime configuration (CLI --debug flag)
 */

type DebugState = {
	enabled: boolean;
	traceEnabled: boolean;
	runtimeOverride: boolean | null;
	runtimeTraceOverride: boolean | null;
};

// Global state
const state: DebugState = {
	enabled: false,
	traceEnabled: false,
	runtimeOverride: null,
	runtimeTraceOverride: null,
};

/**
 * Check if debug mode is enabled
 * Controlled by runtime configuration only.
 */
export function isDebugEnabled(): boolean {
	return state.enabled;
}

/**
 * Check if trace mode is enabled (shows stack traces)
 * Trace mode requires debug mode to be enabled
 */
export function isTraceEnabled(): boolean {
	return state.enabled && state.traceEnabled;
}

export function isDevtoolsEnabled(): boolean {
	return false;
}

/**
 * Enable or disable debug mode at runtime
 * Updates the runtime configuration.
 *
 * @param enabled - true to enable debug mode, false to disable
 */
export function setDebugEnabled(enabled: boolean): void {
	state.enabled = enabled;
	state.runtimeOverride = enabled;
}

/**
 * Enable or disable trace mode at runtime
 * Trace mode shows full stack traces in error logs
 *
 * @param enabled - true to enable trace mode, false to disable
 */
export function setTraceEnabled(enabled: boolean): void {
	state.traceEnabled = enabled;
	state.runtimeTraceOverride = enabled;
}

/**
 * Reset debug state to disabled defaults
 */
export function resetDebugState(): void {
	state.runtimeOverride = null;
	state.runtimeTraceOverride = null;
	state.enabled = false;
	state.traceEnabled = false;
}

/**
 * Get current debug state (for testing/diagnostics)
 */
export function getDebugState(): Readonly<DebugState> {
	return { ...state };
}
