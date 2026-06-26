export type MCPTransport = 'stdio' | 'http' | 'sse';
export type MCPScope = 'global' | 'project';

export type MCPServerSourceKind = 'user' | 'plugin';

export interface MCPServerSource {
	kind: MCPServerSourceKind;
	scope: MCPScope;
	plugin?: string;
	overridesPlugin?: string;
}

export interface MCPOAuthConfig {
	clientId?: string;
	callbackPort?: number;
	scopes?: string[];
}

export interface MCPServerConfig {
	name: string;
	transport?: MCPTransport;

	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;

	url?: string;
	headers?: Record<string, string>;

	oauth?: MCPOAuthConfig;

	disabled?: boolean;

	scope?: MCPScope;
	source?: MCPServerSource;
}

export interface MCPConfig {
	servers: MCPServerConfig[];
}

export interface MCPServerStatus {
	name: string;
	connected: boolean;
	tools: string[];
	error?: string;
	transport?: MCPTransport;
	url?: string;
	authRequired?: boolean;
	authenticated?: boolean;
}
