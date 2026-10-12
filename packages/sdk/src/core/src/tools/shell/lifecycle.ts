/** Shared process/consumer ownership for pipe and PTY shell executions. */
export class ShellExecutionState {
	private phase: 'running' | 'detached' | 'completed' = 'running';
	get processSettled(): boolean {
		return this.phase === 'completed';
	}
	get detached(): boolean {
		return this.phase === 'detached';
	}
	get consumerOwnsProcess(): boolean {
		return this.phase === 'running';
	}
	complete(): boolean {
		if (this.processSettled) return false;
		this.phase = 'completed';
		return true;
	}
	transferToJob(): boolean {
		if (!this.consumerOwnsProcess) return false;
		this.phase = 'detached';
		return true;
	}
}
