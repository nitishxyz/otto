import type { Tool } from 'ai';
import { getToolMetadata } from '@ottocode/sdk';
import {
	redactSensitiveInput,
	type ToolSensitiveInput,
} from '@ottocode/sdk/tools/builtin/fs';

export function getSensitiveInputs(
	tool: Tool | undefined,
): ToolSensitiveInput[] | undefined {
	const sensitive = getToolMetadata(tool)?.sensitiveInputs;
	return sensitive?.length ? sensitive : undefined;
}

/** Input safe to persist, publish, or show in approvals. */
export function redactToolInput(tool: Tool | undefined, input: unknown) {
	return redactSensitiveInput(input, getSensitiveInputs(tool));
}

/** Streaming input deltas are partial JSON and cannot be redacted reliably. */
export function suppressesInputDeltas(tool: Tool | undefined): boolean {
	return Boolean(getSensitiveInputs(tool));
}

/** Scrubs echoes of declared input secrets from results and error messages. */
export function createToolOutputRedactor(
	tool: Tool,
	input: unknown,
): (value: unknown) => unknown {
	const secrets = new Set<string>();
	const collect = (raw: unknown, safe: unknown): void => {
		if (safe === '[redacted]') {
			if (typeof raw === 'string' && raw) secrets.add(raw);
			return;
		}
		if (!raw || !safe || typeof raw !== 'object' || typeof safe !== 'object')
			return;
		for (const [key, value] of Object.entries(raw)) {
			collect(value, (safe as Record<string, unknown>)[key]);
		}
	};
	collect(input, redactToolInput(tool, input));
	const redact = (value: unknown): unknown => {
		if (!secrets.size) return value;
		if (typeof value === 'string') {
			let safe = value;
			for (const secret of secrets)
				safe = safe.split(secret).join('[redacted]');
			return safe;
		}
		if (Array.isArray(value)) return value.map(redact);
		if (value && typeof value === 'object') {
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, redact(item)]),
			);
		}
		return value;
	};
	return redact;
}
