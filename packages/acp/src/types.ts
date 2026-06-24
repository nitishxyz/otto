import type {
	NewSessionRequest,
	PromptResponse,
} from '@agentclientprotocol/sdk';

export const ACP_VERSION = '0.1.196';
export const DEFAULT_MODE = 'general';

export type AcpSession = {
	sessionId: string;
	ottoSessionId: string;
	cwd: string;
	cancelled: boolean;
	assistantMessageId: string | null;
	resolvePrompt: ((response: PromptResponse) => void) | null;
	unsubscribe: (() => void) | null;
	sessionInfoUnsubscribe: (() => void) | null;
	activeTerminals: Map<
		string,
		{ terminalId: string; release: () => Promise<void> }
	>;
	streamedToolCalls: Set<string>;
	streamedToolContent: Map<string, string>;
	terminalToolCalls: Map<string, string>;
	mode: string;
	provider?: string;
	model?: string;
	mcpServers: NewSessionRequest['mcpServers'];
	additionalDirectories: string[];
};
