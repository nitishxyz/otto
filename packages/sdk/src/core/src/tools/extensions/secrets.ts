export type NativeExtensionSecretDefinition = {
	name: string;
	env: string;
	required: boolean;
};

/** Resolve declared native-extension secrets from an injected environment. */
export function collectNativeExtensionSecrets(
	definitions: readonly NativeExtensionSecretDefinition[],
	options: {
		environment: Readonly<Record<string, string | undefined>>;
		toolName: string;
	},
): Record<string, string> {
	const secrets: Record<string, string> = {};
	for (const secret of definitions) {
		const value = options.environment[secret.env];
		if (!value && secret.required) {
			throw new Error(
				`Native tool ${options.toolName} requires secret ${secret.name} from ${secret.env}`,
			);
		}
		if (value) secrets[secret.name] = value;
	}
	return secrets;
}
