import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Globe, Laptop, FolderDot, Terminal } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { StableSpinner } from '../ui/StableSpinner';
import {
	useAddMCPServer,
	useStartMCPServer,
	useStopMCPServer,
} from '../../hooks/useMCP';
import type { MCPScope, MCPServerInfo } from '../../stores/mcpStore';

interface AddMCPServerModalProps {
	isOpen: boolean;
	onClose: () => void;
	editServer?: MCPServerInfo | null;
}

type ServerMode = 'local' | 'remote';

function parseCommandString(input: string): {
	command: string;
	args: string[];
} {
	const parts = input.trim().split(/\s+/);
	return { command: parts[0] ?? '', args: parts.slice(1) };
}

function parseEnv(envStr: string): Record<string, string> | undefined {
	const trimmed = envStr.trim();
	if (!trimmed) return undefined;
	const env: Record<string, string> = {};
	for (const line of trimmed.split('\n')) {
		const eq = line.indexOf('=');
		if (eq > 0) {
			env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
		}
	}
	return Object.keys(env).length > 0 ? env : undefined;
}

function parseHeaders(headerStr: string): Record<string, string> | undefined {
	const trimmed = headerStr.trim();
	if (!trimmed) return undefined;
	const headers: Record<string, string> = {};
	for (const line of trimmed.split('\n')) {
		const colon = line.indexOf(':');
		if (colon > 0) {
			headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
		}
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

function formatEnv(env?: Record<string, string>): string {
	if (!env) return '';
	return Object.entries(env)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');
}

function formatHeaders(headers?: Record<string, string>): string {
	if (!headers) return '';
	return Object.entries(headers)
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');
}

export const AddMCPServerModal = memo(function AddMCPServerModal({
	isOpen,
	onClose,
	editServer,
}: AddMCPServerModalProps) {
	const [serverMode, setServerMode] = useState<ServerMode>('local');
	const [name, setName] = useState('');
	const [commandStr, setCommandStr] = useState('');
	const [url, setUrl] = useState('');
	const [transport, setTransport] = useState<'http' | 'sse'>('http');
	const [headersStr, setHeadersStr] = useState('');
	const [envStr, setEnvStr] = useState('');
	const [scope, setScope] = useState<MCPScope>('global');
	const [error, setError] = useState<string | null>(null);
	const [isRestarting, setIsRestarting] = useState(false);
	const isEditing = !!editServer;

	const addServer = useAddMCPServer();
	const startServer = useStartMCPServer();
	const stopServer = useStopMCPServer();
	const prefilledRef = useRef(false);

	useEffect(() => {
		if (!isOpen) {
			prefilledRef.current = false;
			return;
		}
		if (!editServer || prefilledRef.current) return;
		prefilledRef.current = true;
		const isRemote =
			editServer.transport === 'http' || editServer.transport === 'sse';
		setServerMode(isRemote ? 'remote' : 'local');
		setName(editServer.name);
		setCommandStr(
			[editServer.command ?? '', ...editServer.args].join(' ').trim(),
		);
		setUrl(editServer.url ?? '');
		setTransport(editServer.transport === 'sse' ? 'sse' : 'http');
		setEnvStr(formatEnv(editServer.env));
		setHeadersStr(formatHeaders(editServer.headers));
		setScope(editServer.scope);
		setError(null);
	}, [isOpen, editServer]);

	const reset = useCallback(() => {
		setName('');
		setCommandStr('');
		setUrl('');
		setTransport('http');
		setHeadersStr('');
		setEnvStr('');
		setScope('global');
		setError(null);
		setServerMode('local');
	}, []);

	const handleClose = useCallback(() => {
		reset();
		onClose();
	}, [reset, onClose]);

	const handleSubmit = useCallback(async () => {
		setError(null);
		const trimmedName = name.trim();

		if (!trimmedName) {
			setError('Server name is required');
			return;
		}

		try {
			const effectiveScope = editServer ? editServer.scope : scope;
			if (serverMode === 'local') {
				const trimmedCmd = commandStr.trim();
				if (!trimmedCmd) {
					setError('Command is required');
					return;
				}
				if (/^https?:\/\//i.test(trimmedCmd)) {
					setError(
						'Local commands cannot be URLs. Switch to Remote (HTTP) for remote servers.',
					);
					return;
				}
				const { command, args } = parseCommandString(trimmedCmd);
				if (args.some((arg) => /^[\u2010-\u2015\u2212]/.test(arg))) {
					setError(
						'Use regular hyphens in arguments, for example "--yes" instead of "—yes".',
					);
					return;
				}
				await addServer.mutateAsync({
					name: trimmedName,
					transport: 'stdio',
					command,
					args,
					env: parseEnv(envStr),
					scope: effectiveScope,
				});
			} else {
				const trimmedUrl = url.trim();
				if (!trimmedUrl) {
					setError('URL is required');
					return;
				}
				await addServer.mutateAsync({
					name: trimmedName,
					transport,
					url: trimmedUrl,
					headers: parseHeaders(headersStr),
					scope: effectiveScope,
				});
			}
			if (editServer?.connected) {
				setIsRestarting(true);
				try {
					await stopServer.mutateAsync(trimmedName);
					await startServer.mutateAsync(trimmedName);
				} catch {
				} finally {
					setIsRestarting(false);
				}
			}
			handleClose();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: isEditing
						? 'Failed to save server'
						: 'Failed to add server',
			);
		}
	}, [
		name,
		serverMode,
		commandStr,
		envStr,
		url,
		transport,
		headersStr,
		scope,
		addServer,
		editServer,
		isEditing,
		startServer,
		stopServer,
		handleClose,
	]);

	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number | undefined>(
		undefined,
	);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			setContentHeight(el.scrollHeight);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			title={isEditing ? 'Edit MCP Server' : 'Add MCP Server'}
		>
			<div
				className="overflow-hidden transition-[height] duration-200 ease-in-out"
				style={{ height: contentHeight !== undefined ? contentHeight : 'auto' }}
			>
				<div ref={contentRef} className="space-y-4">
					<div className="relative flex w-full rounded-lg bg-muted p-1">
						<div
							className="absolute top-1 bottom-1 rounded-md bg-background shadow-md border border-border transition-all duration-200 ease-in-out"
							style={{
								left: serverMode === 'local' ? '4px' : '50%',
								right: serverMode === 'remote' ? '4px' : '50%',
							}}
						/>
						<button
							type="button"
							onClick={() => setServerMode('local')}
							className={`relative z-10 flex items-center justify-center gap-2 flex-1 text-sm font-medium py-2 rounded-md transition-colors duration-200 ${
								serverMode === 'local'
									? 'text-foreground'
									: 'text-muted-foreground/50'
							}`}
						>
							<Terminal className="w-4 h-4" />
							Local (stdio)
						</button>
						<button
							type="button"
							onClick={() => setServerMode('remote')}
							className={`relative z-10 flex items-center justify-center gap-2 flex-1 text-sm font-medium py-2 rounded-md transition-colors duration-200 ${
								serverMode === 'remote'
									? 'text-foreground'
									: 'text-muted-foreground/50'
							}`}
						>
							<Globe className="w-4 h-4" />
							Remote (HTTP)
						</button>
					</div>

					<div>
						<div className="text-sm font-medium mb-1">Name</div>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. github, linear, helius"
							disabled={isEditing}
							autoFocus={!isEditing}
						/>
					</div>

					{serverMode === 'local' ? (
						<>
							<div>
								<div className="text-sm font-medium mb-1">Command</div>
								<Input
									value={commandStr}
									onChange={(e) => setCommandStr(e.target.value)}
									placeholder="e.g. npx -y @modelcontextprotocol/server-github"
									onKeyDown={(e) => {
										if (e.key === 'Enter') handleSubmit();
									}}
								/>
								<p className="text-xs text-muted-foreground mt-1">
									Like{' '}
									<code className="bg-muted px-1 rounded">
										npx -y helius-mcp@latest
									</code>
								</p>
							</div>
							<div>
								<div className="text-sm font-medium mb-1">
									Environment Variables
								</div>
								<textarea
									value={envStr}
									onChange={(e) => setEnvStr(e.target.value)}
									placeholder={'GITHUB_TOKEN=ghp_xxx\nAPI_KEY=sk-xxx'}
									rows={2}
									className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
								/>
								<p className="text-xs text-muted-foreground mt-1">
									One per line: KEY=VALUE
								</p>
							</div>
						</>
					) : (
						<>
							<div>
								<div className="text-sm font-medium mb-1">URL</div>
								<Input
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="e.g. https://mcp.linear.app/mcp"
									onKeyDown={(e) => {
										if (e.key === 'Enter') handleSubmit();
									}}
								/>
							</div>
							<div>
								<div className="text-sm font-medium mb-1">Transport</div>
								<div className="relative flex w-full rounded-lg border border-border bg-muted/50 p-0.5">
									<div
										className="absolute top-0.5 bottom-0.5 rounded-md bg-background shadow-md border border-border transition-all duration-200 ease-in-out"
										style={{
											left: transport === 'http' ? '2px' : '50%',
											right: transport === 'sse' ? '2px' : '50%',
										}}
									/>
									<button
										type="button"
										onClick={() => setTransport('http')}
										className={`relative z-10 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md flex-1 transition-colors duration-200 ${
											transport === 'http'
												? 'text-foreground'
												: 'text-muted-foreground/50'
										}`}
									>
										HTTP (recommended)
									</button>
									<button
										type="button"
										onClick={() => setTransport('sse')}
										className={`relative z-10 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md flex-1 transition-colors duration-200 ${
											transport === 'sse'
												? 'text-foreground'
												: 'text-muted-foreground/50'
										}`}
									>
										SSE (legacy)
									</button>
								</div>
							</div>
							<div>
								<div className="text-sm font-medium mb-1">Headers</div>
								<textarea
									value={headersStr}
									onChange={(e) => setHeadersStr(e.target.value)}
									placeholder={'Authorization: Bearer xxx'}
									rows={2}
									className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
								/>
								<p className="text-xs text-muted-foreground mt-1">
									One per line: Header-Name: value
								</p>
							</div>
							<p className="text-xs text-muted-foreground">
								For OAuth servers (Linear, Notion, etc.), leave headers empty
								and authenticate after adding.
							</p>
						</>
					)}

					{isEditing ? (
						<div>
							<div className="text-sm font-medium mb-1">Scope</div>
							<div className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-2 border border-border rounded-lg bg-muted/30">
								{scope === 'global' ? (
									<>
										<Laptop className="w-3 h-3" />
										All projects (~/.config/otto/config.json)
									</>
								) : (
									<>
										<FolderDot className="w-3 h-3" />
										This project only (.otto/config.json)
									</>
								)}
							</div>
						</div>
					) : (
						<div>
							<div className="text-sm font-medium mb-1">Scope</div>
							<div className="relative flex w-full rounded-lg border border-border bg-muted/50 p-0.5">
								<div
									className="absolute top-0.5 bottom-0.5 rounded-md bg-background shadow-md border border-border transition-all duration-200 ease-in-out"
									style={{
										left: scope === 'global' ? '2px' : '50%',
										right: scope === 'project' ? '2px' : '50%',
									}}
								/>
								<button
									type="button"
									onClick={() => setScope('global')}
									className={`relative z-10 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md flex-1 transition-colors duration-200 ${
										scope === 'global'
											? 'text-foreground'
											: 'text-muted-foreground/50'
									}`}
								>
									<Laptop className="w-3 h-3" />
									All projects
								</button>
								<button
									type="button"
									onClick={() => setScope('project')}
									className={`relative z-10 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md flex-1 transition-colors duration-200 ${
										scope === 'project'
											? 'text-foreground'
											: 'text-muted-foreground/50'
									}`}
								>
									<FolderDot className="w-3 h-3" />
									This project only
								</button>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{scope === 'global'
									? 'Saved to ~/.config/otto/config.json'
									: 'Saved to .otto/config.json (project-local)'}
							</p>
						</div>
					)}

					{error && (
						<div className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded">
							{error}
						</div>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<Button variant="ghost" onClick={handleClose}>
							Cancel
						</Button>
						<Button
							variant="primary"
							onClick={handleSubmit}
							disabled={addServer.isPending || isRestarting}
						>
							{addServer.isPending || isRestarting ? (
								<>
									<StableSpinner
										size="xs"
										className="mr-1"
										title={isEditing ? 'Saving server' : 'Adding server'}
									/>
									{isRestarting
										? 'Restarting...'
										: isEditing
											? 'Saving...'
											: 'Adding...'}
								</>
							) : isEditing ? (
								'Save Changes'
							) : (
								'Add Server'
							)}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
});
