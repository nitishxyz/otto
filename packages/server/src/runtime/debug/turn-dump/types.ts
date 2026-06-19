export interface TurnDumpData {
	sessionId: string;
	messageId: string;
	timestamp: string;
	provider: string;
	model: string;
	agent: string;
	continuationCount?: number;
	system: {
		prompt: string;
		components: string[];
		length: number;
	};
	additionalSystemMessages: Array<{ role: string; content: string }>;
	history: Array<{
		role: string;
		content: unknown;
		_contentLength?: number;
	}>;
	finalMessages: Array<{
		role: string;
		content: unknown;
		_contentLength?: number;
	}>;
	tools: {
		names: string[];
		count: number;
	};
	modelConfig: {
		maxOutputTokens: number | undefined;
		effectiveMaxOutputTokens: number | undefined;
		providerOptions: Record<string, unknown>;
		isOpenAIOAuth: boolean;
		needsSpoof: boolean;
	};
	stream: {
		toolCalls: Array<{
			stepIndex: number;
			name: string;
			callId: string;
			args: unknown;
			timestamp: string;
		}>;
		toolResults: Array<{
			stepIndex: number;
			name: string;
			callId: string;
			result: unknown;
			_resultLength?: number;
			timestamp: string;
		}>;
		textDeltas: Array<{
			stepIndex: number;
			textSnapshot: string;
			length: number;
			timestamp: string;
		}>;
		steps: Array<{
			stepIndex: number;
			finishReason: string | undefined;
			usage?: {
				inputTokens?: number;
				outputTokens?: number;
			};
			timestamp: string;
		}>;
		finishReason?: string;
		rawFinishReason?: string;
		aborted: boolean;
	};
	error?: {
		message: string;
		name?: string;
		stack?: string;
	};
	duration?: number;
}

export type TurnDumpCollectorOptions = {
	sessionId: string;
	messageId: string;
	provider: string;
	model: string;
	agent: string;
	continuationCount?: number;
};
