import { jsonSchema, tool, type Tool } from 'ai';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type { JSONSchema7 } from '@ai-sdk/provider';
import { setToolMetadata } from '../tools/metadata.ts';
import {
	classificationToEffects,
	type MCPToolClassification,
} from './classify.ts';
import type { MCPServerManager } from './server-manager.ts';

type MCPToolResult = {
	ok: boolean;
	result?: string;
	error?: string;
	images?: Array<{ data: string; mimeType: string }>;
};

/**
 * Preserves the server's original JSON Schema (no lossy conversion). Only the
 * top level is normalized to an object schema, which tool calling requires.
 */
export function mcpInputSchemaToJSONSchema(
	schema: Record<string, unknown> | undefined,
): JSONSchema7 {
	const source = (schema ?? {}) as JSONSchema7;
	if (source.type === 'object') {
		return source.properties ? source : { ...source, properties: {} };
	}
	return { ...source, type: 'object', properties: source.properties ?? {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Wrap MCP tools as AI SDK tools. When a classification is known for a tool,
 * its effects are attached as metadata so approval gating can consult them.
 * The model's abort signal is forwarded to the MCP request.
 */
export function convertMCPToolsToAISDK(
	manager: MCPServerManager,
	classifications?: ReadonlyMap<string, MCPToolClassification>,
): Array<{ name: string; tool: Tool }> {
	const mcpTools = manager.getTools();

	return mcpTools.map(({ name, tool: mcpTool }) => {
		const classification = classifications?.get(name);
		const wrapped = tool({
			description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
			inputSchema: jsonSchema<Record<string, unknown>>(
				mcpInputSchemaToJSONSchema(mcpTool.inputSchema),
				{
					validate: (value) =>
						isPlainObject(value)
							? { success: true, value }
							: {
									success: false,
									error: new Error('MCP tool input must be an object'),
								},
				},
			),
			async execute(args: Record<string, unknown>, options) {
				try {
					return (await manager.callTool(name, args, {
						signal: options?.abortSignal,
					})) as MCPToolResult;
				} catch (err) {
					return {
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					} satisfies MCPToolResult;
				}
			},
			toModelOutput({ output }): ToolResultOutput {
				const result = output as MCPToolResult;
				if (result.images && result.images.length > 0) {
					const parts: Array<
						| { type: 'text'; text: string }
						| { type: 'image-data'; data: string; mediaType: string }
					> = [];
					const text = result.ok ? result.result : result.error;
					if (text) {
						parts.push({ type: 'text', text });
					}
					for (const img of result.images) {
						parts.push({
							type: 'image-data',
							data: img.data,
							mediaType: img.mimeType,
						});
					}
					return { type: 'content', value: parts } as ToolResultOutput;
				}
				return {
					type: 'json',
					value: result as unknown as import('@ai-sdk/provider').JSONValue,
				};
			},
		});
		setToolMetadata(wrapped, {
			source: 'mcp',
			activation: 'mcp',
			...(classification
				? { effects: classificationToEffects(classification) }
				: {}),
		});
		return { name, tool: wrapped };
	});
}
