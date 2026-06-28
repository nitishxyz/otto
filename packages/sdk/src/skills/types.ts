export type SkillScope = 'cwd' | 'parent' | 'repo' | 'user' | 'system';

export interface SkillMetadata {
	name: string;
	description: string;
	license?: string;
	compatibility?: string;
	metadata?: Record<string, string>;
	allowedTools?: string[];
}

export interface SkillDefinition {
	metadata: SkillMetadata;
	content: string;
	path: string;
	scope: SkillScope;
}

export interface DiscoveredSkill {
	name: string;
	description: string;
	path: string;
	scope: SkillScope;
}

export interface SecurityNotice {
	type:
		| 'html_comment'
		| 'hidden_instruction'
		| 'base64_content'
		| 'data_uri'
		| 'invisible_chars';
	description: string;
	line?: number;
}

export interface SkillFileInfo {
	relativePath: string;
	size: number;
}

export interface SkillLoadResult {
	ok: true;
	name: string;
	description: string;
	content: string;
	path: string;
	baseDirectory: string;
	resourceInstructions: string;
	scope: SkillScope;
	allowedTools?: string[];
	availableFiles?: SkillFileInfo[];
	securityNotices?: SecurityNotice[];
}

export interface SkillErrorResult {
	ok: false;
	error: string;
}

export type SkillResult = SkillLoadResult | SkillErrorResult;
