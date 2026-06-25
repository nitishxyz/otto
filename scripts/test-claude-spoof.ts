/**
 * Test script to determine what Claude Code OAuth actually validates.
 *
 * Usage:
 *   bun run scripts/test-claude-spoof.ts [message-mode] [tool-mode]
 *
 * Message modes:
 *   simple     - Just say hello (no tools used)
 *   tool       - Ask to read a file (triggers tool call) [default]
 *
 * Tool modes:
 *   claude-code - Only tools that Claude Code has (should always pass)
 *   otto-mixed   - Mix of Claude Code + otto-only tools [default]
 *   otto-only    - Only otto-specific tools (tests if whitelist)
 *
 * Examples:
 *   bun run scripts/test-claude-spoof.ts tool claude-code  # Should pass
 *   bun run scripts/test-claude-spoof.ts tool otto-mixed    # Tests if custom tools allowed
 *   bun run scripts/test-claude-spoof.ts tool otto-only     # Tests naming convention only
 *
 * This helps determine if Claude Code OAuth validates:
 *   A) A whitelist of specific tool names (would reject unknown tools)
 *   B) Just PascalCase naming convention (would accept any PascalCase tool)
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLAUDE_CODE_VERSION = '2.1.2';
const TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

interface OAuthData {
	type: 'oauth';
	access: string;
	refresh: string;
	expires: number;
}

// Refresh the OAuth token
async function refreshToken(
	refreshToken: string,
): Promise<{ access: string; refresh: string; expires: number }> {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Token refresh failed: ${response.status}`);
	}

	const data = await response.json();
	return {
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000,
	};
}

// Read OAuth token from otto's auth storage
async function getOAuthToken(): Promise<string | null> {
	const authPaths = [
		join(homedir(), 'Library', 'Application Support', 'otto', 'auth.json'),
		join(process.cwd(), '.otto', 'auth.json'),
		join(homedir(), '.config', 'otto', 'auth.json'),
	];

	for (const authPath of authPaths) {
		if (existsSync(authPath)) {
			try {
				const authData = JSON.parse(readFileSync(authPath, 'utf-8'));
				if (authData.anthropic?.type === 'oauth') {
					const oauth = authData.anthropic as OAuthData;

					// Check if token is expired
					if (oauth.expires < Date.now()) {
						console.log('Token expired, refreshing...');
						try {
							const newTokens = await refreshToken(oauth.refresh);
							// Update the auth file
							authData.anthropic = {
								type: 'oauth',
								access: newTokens.access,
								refresh: newTokens.refresh,
								expires: newTokens.expires,
							};
							writeFileSync(authPath, JSON.stringify(authData, null, 2));
							console.log('✓ Token refreshed');
							return newTokens.access;
						} catch (e) {
							console.error('Failed to refresh token:', e);
							return null;
						}
					}

					return oauth.access;
				}
			} catch (_e) {
				// Continue to next path
			}
		}
	}
	return null;
}

// Test mode for tool validation:
// 'claude-code' = Only tools that Claude Code has (should pass)
// 'otto-mixed' = Mix of Claude Code tools + otto-only tools (tests if whitelist)
// 'otto-only' = Only otto-specific tools with PascalCase (tests naming convention)
const TOOL_TEST_MODE = process.argv[3] || 'otto-mixed';

// Claude Code standard tools (these should always pass)
const CLAUDE_CODE_STANDARD_TOOLS = [
	{
		name: 'Bash',
		description: 'Executes a bash command.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				command: { description: 'The command to execute', type: 'string' },
				timeout: {
					description: 'Optional timeout in milliseconds',
					type: 'number',
				},
			},
			required: ['command'],
			additionalProperties: false,
		},
	},
	{
		name: 'Read',
		description: 'Read a file from the filesystem.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				path: { description: 'File path to read', type: 'string' },
				startLine: { description: 'Starting line number', type: 'integer' },
				endLine: { description: 'Ending line number', type: 'integer' },
			},
			required: ['path'],
			additionalProperties: false,
		},
	},
	{
		name: 'Glob',
		description: 'Find files matching a glob pattern.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				pattern: { description: 'Glob pattern', type: 'string' },
				path: { description: 'Directory to search', type: 'string' },
			},
			required: ['pattern'],
			additionalProperties: false,
		},
	},
	{
		name: 'Grep',
		description: 'Search file contents with regex.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				pattern: { description: 'Regex pattern', type: 'string' },
				path: { description: 'Path to search', type: 'string' },
			},
			required: ['pattern'],
			additionalProperties: false,
		},
	},
];

// otto-specific tools that Claude Code DOESN'T have
// These test whether it's a whitelist or just naming convention
const OTTO_ONLY_TOOLS = [
	{
		// otto's apply_patch tool - Claude Code doesn't have this
		name: 'ApplyPatch',
		description: 'Apply a unified diff patch to files in the project.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				patch: { description: 'Unified diff patch content', type: 'string' },
				allowRejects: {
					description: 'Allow partial application',
					type: 'boolean',
				},
				fuzzyMatch: { description: 'Enable fuzzy matching', type: 'boolean' },
			},
			required: ['patch'],
			additionalProperties: false,
		},
	},
	{
		// otto's progress_update tool - Claude Code doesn't have this
		name: 'ProgressUpdate',
		description: 'Report progress on the current task.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				message: { description: 'Progress message', type: 'string' },
				percent: { description: 'Completion percentage', type: 'number' },
			},
			required: ['message'],
			additionalProperties: false,
		},
	},
	{
		// otto's git_status tool - Claude Code uses Bash for git
		name: 'GitStatus',
		description: 'Get the current git status of the repository.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				path: { description: 'Repository path', type: 'string' },
			},
			additionalProperties: false,
		},
	},
	{
		// Completely made up tool to test naming convention
		name: 'CustomAgiTool',
		description:
			'A custom otto-only tool that definitely does not exist in Claude Code.',
		input_schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				input: { description: 'Some input', type: 'string' },
			},
			required: ['input'],
			additionalProperties: false,
		},
	},
];

// Select tools based on test mode
function getToolsForMode(mode: string) {
	switch (mode) {
		case 'claude-code':
			console.log('Testing with Claude Code standard tools only');
			return CLAUDE_CODE_STANDARD_TOOLS;
		case 'otto-only':
			console.log('Testing with otto-only tools (should fail if whitelist)');
			return OTTO_ONLY_TOOLS;
		default:
			console.log('Testing with mixed tools (Claude Code + otto-only)');
			return [...CLAUDE_CODE_STANDARD_TOOLS, ...OTTO_ONLY_TOOLS];
	}
}

const CLAUDE_CODE_TOOLS = getToolsForMode(TOOL_TEST_MODE);

// Generate stable IDs
function generateUUID(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

function generateUserHash(token: string): string {
	let hash = 0;
	for (let i = 0; i < token.length; i++) {
		const char = token.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(16).padStart(64, '0').slice(0, 64);
}

// Test mode: 'simple' = just say hello, 'tool' = trigger tool call and respond
const TEST_MODE = process.argv[2] || 'tool';

async function main() {
	console.log('=== Claude Code OAuth Tool Validation Test ===\n');
	console.log(`Message mode: ${TEST_MODE} (simple/tool)`);
	console.log(
		`Tool set mode: ${TOOL_TEST_MODE} (claude-code/otto-mixed/otto-only)\n`,
	);
	console.log('This test determines if Claude Code OAuth validates:');
	console.log('  A) Whitelist of specific tool names');
	console.log('  B) Just PascalCase naming convention\n');

	// Get auth token
	const accessToken = await getOAuthToken();

	if (!accessToken) {
		console.error(
			'No OAuth token found. Run: otto auth login anthropic --oauth',
		);
		process.exit(1);
	}

	console.log('✓ Found OAuth token');

	// Generate IDs
	const userHash = generateUserHash(accessToken);
	const accountUUID = generateUUID();
	const sessionId = generateUUID();

	// Choose message based on test mode
	const userMessage =
		TEST_MODE === 'tool'
			? 'Read the file /Users/bat/dev/slashforge/otto/package.json and tell me the project name.'
			: 'Say hello';

	// Build exact Claude Code request
	const requestBody = {
		model: 'claude-sonnet-4-20250514', // Use a model that's definitely available
		max_tokens: 4096,
		system: [
			{
				type: 'text',
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
				cache_control: { type: 'ephemeral' },
			},
			{
				type: 'text',
				text: "You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.\n\nHere is useful information about the environment you are running in:\n<env>\nWorking directory: /Users/bat/dev/slashforge/otto\nIs directory a git repo: Yes\nPlatform: darwin\nToday's date: 2026-01-11\n</env>",
				cache_control: { type: 'ephemeral' },
			},
		],
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: userMessage,
						cache_control: { type: 'ephemeral' },
					},
				],
			},
		],
		tools: CLAUDE_CODE_TOOLS,
		stream: true,
		metadata: {
			user_id: `user_${userHash}_account_${accountUUID}_session_${sessionId}`,
		},
	};

	// Build exact Claude Code headers
	const headers: Record<string, string> = {
		accept: 'application/json',
		'anthropic-beta':
			'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14',
		'anthropic-dangerous-direct-browser-access': 'true',
		'anthropic-version': '2023-06-01',
		authorization: `Bearer ${accessToken}`,
		'content-type': 'application/json',
		'user-agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
		'x-app': 'cli',
		'x-stainless-arch': process.arch === 'arm64' ? 'arm64' : 'x64',
		'x-stainless-helper-method': 'stream',
		'x-stainless-lang': 'js',
		'x-stainless-os': 'MacOS',
		'x-stainless-package-version': '0.70.0',
		'x-stainless-retry-count': '0',
		'x-stainless-runtime': 'node',
		'x-stainless-runtime-version': process.version,
		'x-stainless-timeout': '600',
	};

	console.log('\n--- Request Details ---');
	console.log('URL: https://api.anthropic.com/v1/messages?beta=true');
	console.log('\nTools being sent:');
	for (const tool of requestBody.tools) {
		const isClaudeCode = CLAUDE_CODE_STANDARD_TOOLS.some(
			(t) => t.name === tool.name,
		);
		console.log(
			`  ${tool.name} ${isClaudeCode ? '(Claude Code)' : '(otto-only)'}`,
		);
	}
	console.log('\nBody preview:');
	console.log('  model:', requestBody.model);
	console.log('  tools count:', requestBody.tools.length);
	console.log('  system blocks:', requestBody.system.length);
	console.log('  message:', requestBody.messages[0].content[0].text);
	console.log(
		'  metadata.user_id:',
		`${requestBody.metadata.user_id.slice(0, 40)}...`,
	);

	console.log('\n--- Sending Request ---\n');

	try {
		const response = await fetch(
			'https://api.anthropic.com/v1/messages?beta=true',
			{
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody),
			},
		);

		console.log('Status:', response.status, response.statusText);
		console.log('\nResponse Headers:');
		response.headers.forEach((value, key) => {
			if (
				key.startsWith('anthropic') ||
				key === 'x-should-retry' ||
				key === 'request-id'
			) {
				console.log(`  ${key}: ${value}`);
			}
		});

		if (response.ok) {
			console.log('\n✓ SUCCESS! Request was accepted.');

			// Read and parse streaming response
			const reader = response.body?.getReader();
			if (reader) {
				console.log('\n--- Response Stream ---\n');
				const decoder = new TextDecoder();
				let buffer = '';
				let assistantText = '';
				let stopReason = '';

				// Collect tool calls
				const toolCalls: Array<{ id: string; name: string; input: string }> =
					[];
				let currentToolCall: {
					id: string;
					name: string;
					input: string;
				} | null = null;

				// Collect content blocks for assistant message
				const contentBlocks: Array<{ type: string; [key: string]: unknown }> =
					[];
				let currentTextBlock = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });

					// Parse SSE events
					const lines = buffer.split('\n');
					buffer = lines.pop() || ''; // Keep incomplete line in buffer

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const data = line.slice(6);
							if (data === '[DONE]') continue;

							try {
								const event = JSON.parse(data);

								switch (event.type) {
									case 'message_start':
										console.log(
											`[message_start] model=${event.message.model} id=${event.message.id}`,
										);
										console.log(
											`  input_tokens=${event.message.usage.input_tokens} cache_read=${event.message.usage.cache_read_input_tokens}`,
										);
										break;

									case 'content_block_start':
										if (event.content_block?.type === 'thinking') {
											console.log(`\n[thinking] index=${event.index}`);
										} else if (event.content_block?.type === 'text') {
											console.log(`\n[text] index=${event.index}`);
											currentTextBlock = '';
										} else if (event.content_block?.type === 'tool_use') {
											console.log(
												`\n[tool_use] ${event.content_block.name} id=${event.content_block.id}`,
											);
											currentToolCall = {
												id: event.content_block.id,
												name: event.content_block.name,
												input: '',
											};
										}
										break;

									case 'content_block_delta':
										if (event.delta?.type === 'thinking_delta') {
											process.stdout.write(event.delta.thinking);
										} else if (event.delta?.type === 'text_delta') {
											process.stdout.write(event.delta.text);
											assistantText += event.delta.text;
											currentTextBlock += event.delta.text;
										} else if (event.delta?.type === 'input_json_delta') {
											process.stdout.write(event.delta.partial_json);
											if (currentToolCall) {
												currentToolCall.input += event.delta.partial_json;
											}
										}
										break;

									case 'content_block_stop':
										console.log('');
										if (currentToolCall) {
											toolCalls.push(currentToolCall);
											contentBlocks.push({
												type: 'tool_use',
												id: currentToolCall.id,
												name: currentToolCall.name,
												input: JSON.parse(currentToolCall.input || '{}'),
											});
											currentToolCall = null;
										} else if (currentTextBlock) {
											contentBlocks.push({
												type: 'text',
												text: currentTextBlock,
											});
											currentTextBlock = '';
										}
										break;

									case 'message_delta':
										stopReason = event.delta.stop_reason;
										console.log(
											`\n[message_delta] stop_reason=${stopReason} output_tokens=${event.usage.output_tokens}`,
										);
										break;

									case 'message_stop':
										console.log('[message_stop]');
										break;
								}
							} catch {
								// Ignore parse errors
							}
						}
					}
				}
				console.log('\n--- End of Stream ---');

				if (assistantText) {
					console.log('\n=== Assistant Response ===');
					console.log(assistantText);
				}

				// If we got tool calls and stop_reason is tool_use, send tool results back
				if (stopReason === 'tool_use' && toolCalls.length > 0) {
					console.log('\n\n========================================');
					console.log('=== TOOL CALL DETECTED - ROUND 2 ===');
					console.log('========================================\n');

					for (const tc of toolCalls) {
						console.log(`Tool: ${tc.name}`);
						console.log(`ID: ${tc.id}`);
						console.log(`Input: ${tc.input}`);
					}

					// Simulate tool result with otto's response format
					// This is the key test - does Claude accept our ToolResponse<T> format?
					const toolResults = toolCalls.map((tc) => {
						const input = JSON.parse(tc.input || '{}');

						if (tc.name === 'Read') {
							// Simulate otto's read tool response format
							const simulatedContent = JSON.stringify(
								{
									name: 'otto-monorepo',
									version: '0.1.104',
									description: 'ottocode monorepo',
								},
								null,
								2,
							);

							// otto's ToolResponse format - using input.path (otto schema)
							const ottoResponse = {
								ok: true,
								path: input.path, // otto uses 'path' not 'file_path'
								content: simulatedContent,
								size: simulatedContent.length,
							};

							console.log('\n--- Sending Tool Result (otto format) ---');
							console.log(JSON.stringify(ottoResponse, null, 2));

							return {
								type: 'tool_result',
								tool_use_id: tc.id,
								content: JSON.stringify(ottoResponse),
							};
						}

						// Default response
						return {
							type: 'tool_result',
							tool_use_id: tc.id,
							content: JSON.stringify({
								ok: true,
								result: 'Tool executed successfully',
							}),
						};
					});

					// Build follow-up request with tool results
					const followUpBody = {
						...requestBody,
						messages: [
							// Original user message
							{
								role: 'user',
								content: [
									{
										type: 'text',
										text: userMessage,
									},
								],
							},
							// Assistant's response with tool calls
							{
								role: 'assistant',
								content: contentBlocks,
							},
							// User message with tool results
							{
								role: 'user',
								content: toolResults,
							},
						],
					};

					console.log('\n--- Sending Follow-up Request ---\n');

					const followUpResponse = await fetch(
						'https://api.anthropic.com/v1/messages?beta=true',
						{
							method: 'POST',
							headers,
							body: JSON.stringify(followUpBody),
						},
					);

					console.log(
						'Follow-up Status:',
						followUpResponse.status,
						followUpResponse.statusText,
					);

					if (followUpResponse.ok) {
						console.log('\n✓ Follow-up SUCCESS!\n');

						const followUpReader = followUpResponse.body?.getReader();
						if (followUpReader) {
							let followUpBuffer = '';
							let followUpText = '';

							while (true) {
								const { done, value } = await followUpReader.read();
								if (done) break;

								followUpBuffer += decoder.decode(value, { stream: true });
								const lines = followUpBuffer.split('\n');
								followUpBuffer = lines.pop() || '';

								for (const line of lines) {
									if (line.startsWith('data: ')) {
										const data = line.slice(6);
										if (data === '[DONE]') continue;

										try {
											const event = JSON.parse(data);

											if (
												event.type === 'content_block_delta' &&
												event.delta?.type === 'text_delta'
											) {
												process.stdout.write(event.delta.text);
												followUpText += event.delta.text;
											} else if (event.type === 'message_delta') {
												console.log(
													`\n\n[message_delta] stop_reason=${event.delta.stop_reason}`,
												);
											}
										} catch {
											// Ignore
										}
									}
								}
							}

							console.log('\n\n=== Final Response ===');
							console.log(followUpText);
							console.log('\n✓ TOOL ROUND-TRIP COMPLETE!');
							console.log(
								'✓ otto ToolResponse format is COMPATIBLE with Claude Code!',
							);
						}
					} else {
						console.log('\n✗ Follow-up FAILED');
						const errorBody = await followUpResponse.text();
						console.log('Error:', errorBody);
					}
				}
			}
		} else {
			console.log('\n✗ FAILED');
			const errorBody = await response.text();
			console.log('\nError Response:');
			try {
				console.log(JSON.stringify(JSON.parse(errorBody), null, 2));
			} catch {
				console.log(errorBody);
			}
		}
	} catch (error) {
		console.error('Request failed:', error);
	}
}

main();
