import { pluginNameSchema, type PluginCommand } from '@ottocode/sdk';
import type {
	ParsedPluginCommandArgs,
	PluginCommandInvocation,
} from './types.ts';

const PLUGIN_COMMAND_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const PLACEHOLDER_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function parsePluginCommandInvocation(
	content: string,
): PluginCommandInvocation | null {
	const trimmed = content.trim();
	if (!trimmed.startsWith('/')) return null;

	const withoutSlash = trimmed.slice(1);
	const firstSpace = withoutSlash.search(/\s/);
	const plugin =
		firstSpace === -1 ? withoutSlash : withoutSlash.slice(0, firstSpace);
	if (!pluginNameSchema.safeParse(plugin).success) return null;

	const remainder =
		firstSpace === -1 ? '' : withoutSlash.slice(firstSpace + 1).trim();
	if (!remainder) return null;

	const secondSpace = remainder.search(/\s/);
	const command =
		secondSpace === -1 ? remainder : remainder.slice(0, secondSpace);
	if (!PLUGIN_COMMAND_NAME_PATTERN.test(command)) return null;

	return {
		plugin,
		command,
		argsText: secondSpace === -1 ? '' : remainder.slice(secondSpace + 1).trim(),
	};
}

export function tokenizePluginCommandArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;

	for (const ch of input) {
		if (quote) {
			if (ch === quote) {
				quote = null;
				tokens.push(current);
				current = '';
				continue;
			}
			current += ch;
			continue;
		}

		if (ch === '"' || ch === "'") {
			if (current) {
				tokens.push(current);
				current = '';
			}
			quote = ch;
			continue;
		}

		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = '';
			}
			continue;
		}

		current += ch;
	}

	if (current) tokens.push(current);
	return tokens;
}

export function parsePluginCommandArgs(
	argsText: string,
	definition: PluginCommand,
): ParsedPluginCommandArgs {
	const parameters = definition.parameters ?? {};
	const values: Record<string, string | number | boolean> = {};
	for (const [name, parameter] of Object.entries(parameters)) {
		if (parameter.default !== undefined) {
			values[name] = parameter.default;
		}
	}

	const extraArgs: string[] = [];
	const tokens = tokenizePluginCommandArgs(argsText);
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token) continue;

		if (!token.startsWith('--')) {
			if (definition.allowExtraArgs) {
				extraArgs.push(token);
				continue;
			}
			return { ok: false, error: `Unknown argument: ${token}` };
		}

		const body = token.slice(2);
		if (!body) {
			return { ok: false, error: 'Invalid argument token' };
		}

		let key = body;
		let rawValue: string | undefined;
		const equalsIndex = body.indexOf('=');
		if (equalsIndex !== -1) {
			key = body.slice(0, equalsIndex);
			rawValue = body.slice(equalsIndex + 1);
		} else if (!(key in parameters)) {
			if (definition.allowExtraArgs) {
				extraArgs.push(`--${key}`);
				continue;
			}
			return { ok: false, error: `Unknown argument: ${key}` };
		} else {
			const parameter = parameters[key];
			const nextToken = tokens[index + 1];
			if (parameter?.type === 'boolean') {
				if (nextToken && !nextToken.startsWith('--')) {
					rawValue = nextToken;
					index += 1;
				} else {
					rawValue = 'true';
				}
			} else if (nextToken && !nextToken.startsWith('--')) {
				rawValue = nextToken;
				index += 1;
			} else {
				return { ok: false, error: `Missing value for argument: ${key}` };
			}
		}

		if (!(key in parameters)) {
			if (definition.allowExtraArgs) {
				extraArgs.push(
					rawValue === undefined ? `--${key}` : `--${key}=${rawValue}`,
				);
				continue;
			}
			return { ok: false, error: `Unknown argument: ${key}` };
		}

		const coerced = coerceParameterValue(parameters[key], rawValue ?? '');
		if (!coerced.ok) return coerced;
		values[key] = coerced.value;
	}

	for (const [name, parameter] of Object.entries(parameters)) {
		if (parameter.required && !(name in values)) {
			return { ok: false, error: `Missing required argument: ${name}` };
		}
	}

	for (const placeholder of collectPlaceholders(definition)) {
		if (!(placeholder in values)) {
			return {
				ok: false,
				error: `Missing required placeholder: ${placeholder}`,
			};
		}
	}

	return { ok: true, values, extraArgs };
}

export function normalizePluginCommandRunInput(
	definition: PluginCommand,
	input: {
		argsText?: string;
		args?: Record<string, string | number | boolean>;
		extraArgs?: string[];
	},
): ParsedPluginCommandArgs {
	if (input.argsText?.trim()) {
		const parsed = parsePluginCommandArgs(input.argsText, definition);
		if (!parsed.ok) return parsed;
		if (!input.extraArgs?.length) return parsed;
		if (!definition.allowExtraArgs) {
			return {
				ok: false,
				error: `Unknown argument: ${input.extraArgs[0]}`,
			};
		}
		return {
			ok: true,
			values: parsed.values,
			extraArgs: [...parsed.extraArgs, ...input.extraArgs],
		};
	}

	if (input.args && Object.keys(input.args).length > 0) {
		const parts: string[] = [];
		for (const [key, value] of Object.entries(input.args)) {
			if (typeof value === 'boolean') {
				parts.push(value ? `--${key}` : `--${key}=false`);
				continue;
			}
			parts.push(`--${key}`, String(value));
		}
		const parsed = parsePluginCommandArgs(parts.join(' '), definition);
		if (!parsed.ok) return parsed;
		if (!input.extraArgs?.length) return parsed;
		if (!definition.allowExtraArgs) {
			return {
				ok: false,
				error: `Unknown argument: ${input.extraArgs[0]}`,
			};
		}
		return {
			ok: true,
			values: parsed.values,
			extraArgs: [...parsed.extraArgs, ...input.extraArgs],
		};
	}

	const parsed = parsePluginCommandArgs('', definition);
	if (!parsed.ok) return parsed;
	if (!input.extraArgs?.length) return parsed;
	if (!definition.allowExtraArgs) {
		return {
			ok: false,
			error: `Unknown argument: ${input.extraArgs[0]}`,
		};
	}
	return {
		ok: true,
		values: parsed.values,
		extraArgs: input.extraArgs,
	};
}

function collectPlaceholders(definition: PluginCommand): string[] {
	const placeholders = new Set<string>();
	for (const value of [
		...(definition.args ?? []),
		...Object.values(definition.env ?? {}),
		...(definition.cwd ? [definition.cwd] : []),
	]) {
		for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
			const name = match[1];
			if (name) placeholders.add(name);
		}
	}
	return Array.from(placeholders);
}

function coerceParameterValue(
	parameter: NonNullable<PluginCommand['parameters']>[string],
	rawValue: string,
):
	| { ok: true; value: string | number | boolean }
	| { ok: false; error: string } {
	switch (parameter.type) {
		case 'string':
		case 'enum': {
			const value = rawValue.trim();
			if (!value) {
				return { ok: false, error: 'Argument value cannot be empty' };
			}
			if (
				parameter.type === 'enum' &&
				parameter.values?.length &&
				!parameter.values.includes(value)
			) {
				return {
					ok: false,
					error: `Invalid value for argument. Expected one of: ${parameter.values.join(', ')}`,
				};
			}
			return { ok: true, value };
		}
		case 'number': {
			const value = Number(rawValue);
			if (!Number.isFinite(value)) {
				return { ok: false, error: 'Argument value must be a number' };
			}
			return { ok: true, value };
		}
		case 'boolean': {
			const normalized = rawValue.trim().toLowerCase();
			if (['true', '1', 'yes', 'on'].includes(normalized)) {
				return { ok: true, value: true };
			}
			if (['false', '0', 'no', 'off'].includes(normalized)) {
				return { ok: true, value: false };
			}
			return { ok: false, error: 'Argument value must be a boolean' };
		}
		default:
			return { ok: false, error: 'Unsupported parameter type' };
	}
}
