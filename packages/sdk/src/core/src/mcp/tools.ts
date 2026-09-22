import { tool, type Tool } from 'ai';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import { z } from 'zod/v3';
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
 * Wrap MCP tools as AI SDK tools. When a classification is known for a tool,
 * its effects are attached as metadata so approval gating can consult them.
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
			inputSchema: jsonSchemaToZod(
				mcpTool.inputSchema,
			) as z.ZodObject<z.ZodRawShape>,
			async execute(args: Record<string, unknown>) {
				try {
					return (await manager.callTool(name, args)) as MCPToolResult;
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

type JSONSchema = {
	type?: string;
	description?: string;
	enum?: string[];
	properties?: Record<string, JSONSchema>;
	required?: string[];
	items?: JSONSchema;
	default?: unknown;
};

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
	const properties = schema.properties as
		| Record<string, JSONSchema>
		| undefined;
	if (!properties) return z.object({});

	const required = new Set((schema.required as string[]) ?? []);
	const shape: Record<string, z.ZodTypeAny> = {};

	for (const [key, prop] of Object.entries(properties)) {
		let field = convertProperty(prop);
		if (!required.has(key)) field = field.optional();
		shape[key] = field;
	}

	return z.object(shape);
}

function convertProperty(prop: JSONSchema): z.ZodTypeAny {
	if (prop.enum) {
		const enumSchema = z.enum(prop.enum as [string, ...string[]]);
		return prop.description
			? enumSchema.describe(prop.description)
			: enumSchema;
	}

	switch (prop.type) {
		case 'string': {
			const s = z.string();
			return prop.description ? s.describe(prop.description) : s;
		}
		case 'number': {
			const n = z.number();
			return prop.description ? n.describe(prop.description) : n;
		}
		case 'integer': {
			const i = z.number().int();
			return prop.description ? i.describe(prop.description) : i;
		}
		case 'boolean': {
			const b = z.boolean();
			return prop.description ? b.describe(prop.description) : b;
		}
		case 'array': {
			const items = prop.items ? convertProperty(prop.items) : z.unknown();
			const a = z.array(items);
			return prop.description ? a.describe(prop.description) : a;
		}
		case 'object': {
			return jsonSchemaToZod(prop as Record<string, unknown>);
		}
		default: {
			const u = z.unknown();
			return prop.description ? u.describe(prop.description) : u;
		}
	}
}
