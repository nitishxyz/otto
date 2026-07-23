import {
	listSessionShellJobs as apiListSessionShellJobs,
	detachSessionShellJob as apiDetachSessionShellJob,
	abortSessionShellJob as apiAbortSessionShellJob,
} from '@ottocode/api';
import { extractErrorMessage, getProjectQuery } from './utils';

export type ShellJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type ShellJob = {
	id: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	command: string;
	cwd: string;
	status: ShellJobStatus;
	detached: boolean;
	output: string;
	exitCode: number | null;
	result?: unknown;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
};

export const shellJobsMixin = {
	async listSessionShellJobs(sessionId: string): Promise<{ jobs: ShellJob[] }> {
		const response = await apiListSessionShellJobs({
			path: { sessionId },
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { jobs: ShellJob[] };
	},

	async detachSessionShellJob(
		sessionId: string,
		jobId: string,
	): Promise<{ job: ShellJob }> {
		const response = await apiDetachSessionShellJob({
			path: { sessionId, jobId },
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { job: ShellJob };
	},

	async abortSessionShellJob(
		sessionId: string,
		jobId: string,
	): Promise<{ job: ShellJob }> {
		const response = await apiAbortSessionShellJob({
			path: { sessionId, jobId },
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { job: ShellJob };
	},
};
