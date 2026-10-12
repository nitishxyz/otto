import { createToolError, type ToolResponse } from '../error.ts';
import type { ShellOutcome } from './engine.ts';

export type ShellExecutionResult = ToolResponse<{
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	detached?: boolean;
	jobId?: string;
	status?: 'running';
	outputMode?: 'auto' | 'full' | 'tail';
	tailLines?: number;
	maxOutputBytes?: number;
	stdoutTruncated?: boolean;
	stdoutOriginalBytes?: number;
	stdoutShownBytes?: number;
	stderrTruncated?: boolean;
	stderrOriginalBytes?: number;
	stderrShownBytes?: number;
	discoveryHint?: string;
	envMode?: 'minimal' | 'login-cache' | 'login-fresh';
	envHint?: string;
}>;

export function formatShellResult(
	outcome: ShellOutcome,
	input: {
		cmd: string;
		timeout: number;
		allowNonZeroExit?: boolean;
		envMode: 'minimal' | 'login-cache' | 'login-fresh';
		envHint?: string;
		discoveryHint?: string;
	},
): ShellExecutionResult {
	const details = {
		cmd: input.cmd,
		stdout: outcome.stdout,
		stderr: outcome.stderr,
		envMode: input.envMode,
		...outcome.metadata,
	};
	if (outcome.reason === 'abort') {
		return createToolError(
			`Command aborted by user: ${input.cmd}`,
			'abort',
			details,
		);
	}
	if (outcome.reason === 'timeout') {
		return createToolError(
			`Command timed out after ${input.timeout}ms: ${input.cmd}`,
			'timeout',
			{
				...details,
				parameter: 'timeout',
				value: input.timeout,
				suggestion: 'Increase timeout or optimize the command',
			},
		);
	}
	if (outcome.error) {
		return createToolError(
			`Command execution failed: ${outcome.error.message}`,
			'execution',
			{
				...details,
				originalError: outcome.error.message,
			},
		);
	}
	if (outcome.exitCode === null) {
		return createToolError(
			`Command terminated by signal ${outcome.signal ?? 'unknown'}`,
			'execution',
			{
				...details,
				signal: outcome.signal,
			},
		);
	}
	if (outcome.exitCode !== 0 && !input.allowNonZeroExit) {
		const errorDetail = outcome.stderr.trim() || outcome.stdout.trim();
		return createToolError(
			`Command failed with exit code ${outcome.exitCode}${errorDetail ? `\n\n${errorDetail}` : ''}`,
			'execution',
			{
				...details,
				exitCode: outcome.exitCode,
				...(input.envHint ? { envHint: input.envHint } : {}),
				suggestion: 'Check command syntax or use allowNonZeroExit: true',
			},
		);
	}
	return {
		ok: true,
		...details,
		exitCode: outcome.exitCode,
		...(input.envHint ? { envHint: input.envHint } : {}),
		...(input.discoveryHint ? { discoveryHint: input.discoveryHint } : {}),
	};
}
