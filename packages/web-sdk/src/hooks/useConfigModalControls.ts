import { useCallback, useState } from 'react';

export type ConfigFocusTarget = 'agent' | 'model' | null;

/**
 * Shared open/close + focus-target state for the chat ConfigModal.
 * Used by both the existing-session input and the new-session landing.
 */
export function useConfigModalControls() {
	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const [configFocusTarget, setConfigFocusTarget] =
		useState<ConfigFocusTarget>(null);

	const openConfig = useCallback((target: ConfigFocusTarget) => {
		setConfigFocusTarget(target);
		setIsConfigOpen(true);
	}, []);

	const toggleConfig = useCallback(() => {
		setIsConfigOpen((prev) => !prev);
	}, []);

	const closeConfig = useCallback(() => {
		setIsConfigOpen(false);
		setConfigFocusTarget(null);
	}, []);

	const openModelConfig = useCallback(() => {
		openConfig('model');
	}, [openConfig]);

	const openAgentConfig = useCallback(() => {
		openConfig('agent');
	}, [openConfig]);

	return {
		isConfigOpen,
		configFocusTarget,
		openConfig,
		toggleConfig,
		closeConfig,
		openModelConfig,
		openAgentConfig,
	};
}
