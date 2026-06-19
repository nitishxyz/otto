export type ToolFailureState = {
	active: boolean;
	toolName?: string;
};

export function markToolFailed(
	stepState: { failed: boolean; failedToolName?: string },
	failureState: ToolFailureState,
	name: string,
): void {
	stepState.failed = true;
	stepState.failedToolName = name;
	failureState.active = true;
	failureState.toolName = name;
}

export function markToolSucceeded(
	stepState: { failed: boolean; failedToolName?: string },
	failureState: ToolFailureState,
	name: string,
): void {
	stepState.failed = false;
	stepState.failedToolName = undefined;
	if (failureState.active && failureState.toolName === name) {
		failureState.active = false;
		failureState.toolName = undefined;
	}
}
