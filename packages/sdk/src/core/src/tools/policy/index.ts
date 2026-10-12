export {
	canonicalRoot,
	canonicalizePath,
	expandHomePath,
	isAbsolutePathLike,
	isPathWithin,
	resolvePolicyPath,
	resolveProjectPath,
	toExecutionPath,
	type PathBase,
	type PathResolutionContext,
	type PathScope,
	type ResolvedPath,
} from './path-resolution.ts';
export {
	REDACTED_INPUT_VALUE,
	hasSensitiveInputValue,
	redactSensitiveInput,
	type ToolSensitiveInput,
} from './sensitive-input.ts';
