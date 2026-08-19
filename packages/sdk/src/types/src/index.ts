// Provider types
export {
	BUILT_IN_PROVIDER_DESCRIPTORS,
	builtInProviderIds,
	getBuiltInProviderDescriptor,
} from './provider-descriptors.ts';
export type {
	BuiltInProviderDescriptor,
	ProviderRuntimeKind,
} from './provider-descriptors.ts';
export type {
	BuiltInProviderId,
	ProviderId,
	ProviderCompatibility,
	ProviderPromptFamily,
	ProviderFamily,
	ModelOwner,
	ModelAuthType,
	ModelInfo,
	ModelInfoMap,
	ModelProviderBinding,
	ProviderCatalogEntry,
} from './provider';

// Auth types
export type { ApiAuth, OAuth, AuthInfo, AuthFile } from './auth';

// Config types
export type {
	Scope,
	DefaultConfig,
	PathConfig,
	ProviderSettingsEntry,
	ProviderSettings,
	SkillSettings,
	ReferenceSource,
	ReferenceConfig,
	ReferenceSettings,
	OttoConfig,
	ToolApprovalMode,
	ReasoningLevel,
	DictationKeyword,
} from './config';
