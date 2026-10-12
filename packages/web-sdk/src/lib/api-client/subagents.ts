import { listSessionSubagents as apiListSessionSubagents } from '@ottocode/api';
import { extractErrorMessage, getProjectQuery } from './utils';

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type Subagent = {
	id: string;
	parentSessionId: string;
	childSessionId: string;
	agent: string;
	task: string;
	status: SubagentStatus;
	summary: string | null;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
};

export const subagentsMixin = {
	async listSessionSubagents(
		sessionId: string,
		status?: SubagentStatus,
	): Promise<{ subagents: Subagent[] }> {
		const response = await apiListSessionSubagents({
			path: { sessionId },
			query: status ? { ...getProjectQuery(), status } : getProjectQuery(),
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { subagents: Subagent[] };
	},
};
