import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
	ChevronDown,
	ChevronRight,
	ClipboardCopy,
	ExternalLink,
	FolderDot,
	Globe,
	Laptop,
	Lock,
	Pencil,
	Plug,
	Plus,
	Search,
	Trash2,
	Wrench,
	X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import { Modal } from '../ui/Modal';
import { useMCPStore, type MCPServerInfo } from '../../stores/mcpStore';
import {
	getMcpSourceLabel,
	isPluginManagedMcpServer,
} from '../../lib/mcp-source';
import { useQueryClient } from '@tanstack/react-query';
import {
	useMCPServers,
	useStartMCPServer,
	useStopMCPServer,
	useRemoveMCPServer,
	useAuthenticateMCPServer,
	useMCPAuthStatus,
	useCopilotDevicePoller,
} from '../../hooks/useMCP';
import { openUrl } from '../../lib/open-url';
import { AddMCPServerModal } from './AddMCPServerModal';
import { ToggleSwitch } from '../ui/ToggleSwitch';

const CopilotDeviceAuth = memo(function CopilotDeviceAuth({
	userCode,
	verificationUri,
}: {
	userCode: string;
	verificationUri: string;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(userCode).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [userCode]);

	return (
		<div className="px-3 pb-2.5 pt-0">
			<div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-2 space-y-1.5">
				<div className="flex items-center gap-1.5 text-xs">
					<StableSpinner
						size="xs"
						className="flex-shrink-0 text-yellow-500"
						title="Waiting for GitHub auth"
					/>
					<span className="text-yellow-500/80">Enter code at GitHub:</span>
				</div>
				<div className="flex items-center gap-2">
					<code className="text-sm font-mono font-bold text-yellow-400 tracking-wider">
						{userCode}
					</code>
					<button
						type="button"
						onClick={handleCopy}
						className="text-yellow-500/60 hover:text-yellow-400 transition-colors"
						title="Copy code"
					>
						<ClipboardCopy className="w-3.5 h-3.5" />
					</button>
					{copied && <span className="text-xs text-green-400">Copied!</span>}
				</div>
				<a
					href={verificationUri}
					target="_blank"
					rel="noopener noreferrer"
					onClick={(e) => {
						e.preventDefault();
						openUrl(verificationUri);
					}}
					className="inline-flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 underline underline-offset-2"
				>
					Open GitHub login
					<ExternalLink className="w-3 h-3" />
				</a>
			</div>
		</div>
	);
});

const MCPServerCard = memo(function MCPServerCard({
	server,
	isLoading,
	authUrl,
	copilotDevice,
	onStart,
	onStop,
	onRemove,
	onEdit,
	onAuth,
}: {
	server: MCPServerInfo;
	isLoading: boolean;
	authUrl?: string;
	copilotDevice?: { userCode: string; verificationUri: string } | null;
	onStart: () => void;
	onStop: () => void;
	onRemove: () => void;
	onEdit: () => void;
	onAuth: () => void;
}) {
	const [showTools, setShowTools] = useState(false);
	const hasTools = server.connected && server.tools.length > 0;
	const isRemote = server.transport === 'http' || server.transport === 'sse';
	const isAwaitingAuth = (!!authUrl || !!copilotDevice) && !server.connected;
	const isPluginManaged = isPluginManagedMcpServer(server);
	const sourceLabel = getMcpSourceLabel(server);

	const handleToggle = useCallback(() => {
		if (server.authRequired && !server.connected) {
			onAuth();
		} else if (server.connected) {
			onStop();
		} else {
			onStart();
		}
	}, [server.connected, server.authRequired, onAuth, onStop, onStart]);

	const toggleTools = useCallback(() => {
		if (hasTools) setShowTools((prev) => !prev);
	}, [hasTools]);

	return (
		<div
			className={`group transition-colors duration-200 ${
				server.connected
					? 'bg-green-500/5 hover:bg-green-500/10'
					: isAwaitingAuth
						? 'bg-yellow-500/5 hover:bg-yellow-500/10'
						: 'hover:bg-accent'
			}`}
		>
			<div className="flex items-center gap-3 px-3 py-2">
				<ToggleSwitch
					checked={server.connected}
					loading={isLoading || isAwaitingAuth}
					onChange={handleToggle}
				/>

				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-sm font-medium truncate">{server.name}</span>
						{isRemote && (
							<Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
						)}
						{server.authRequired && !server.connected && (
							<Lock className="w-3 h-3 text-yellow-500 flex-shrink-0" />
						)}
						{isPluginManaged && (
							<span
								className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] leading-none font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-1 py-0.5"
								title={`Provided by ${sourceLabel}`}
							>
								<Plug className="w-2.5 h-2.5" />
								{server.sourcePlugin ?? 'plugin'}
							</span>
						)}
					</div>
					<div className="flex items-center gap-1.5 mt-0.5">
						<span className="text-xs text-muted-foreground truncate">
							{isRemote
								? server.url
								: `${server.command ?? ''} ${server.args.join(' ')}`}
						</span>
						<span
							className="flex items-center flex-shrink-0 opacity-50"
							title={`${server.name} — ${sourceLabel}`}
						>
							{server.scope === 'project' ? (
								<FolderDot className="w-3 h-3" />
							) : (
								<Laptop className="w-3 h-3" />
							)}
						</span>
					</div>
				</div>

				<div className="flex items-center gap-0.5 flex-shrink-0">
					{hasTools && (
						<button
							type="button"
							onClick={toggleTools}
							className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-1.5 py-1 rounded transition-colors"
						>
							<Wrench className="w-3 h-3" />
							{server.tools.length}
							{showTools ? (
								<ChevronDown className="w-3 h-3" />
							) : (
								<ChevronRight className="w-3 h-3" />
							)}
						</button>
					)}
					<div className="flex items-center max-w-0 opacity-0 translate-x-1 overflow-hidden group-hover:max-w-16 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 ease-out">
						{!isPluginManaged && (
							<Button
								variant="ghost"
								size="icon"
								onClick={onEdit}
								title="Edit server"
								className="h-6 w-6 flex-shrink-0"
							>
								<Pencil className="w-3 h-3 text-muted-foreground hover:text-foreground" />
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon"
							onClick={onRemove}
							title="Remove server"
							className="h-6 w-6 flex-shrink-0"
						>
							<Trash2 className="w-3 h-3 text-muted-foreground hover:text-red-400" />
						</Button>
					</div>
				</div>
			</div>

			{copilotDevice && !server.connected && (
				<CopilotDeviceAuth
					userCode={copilotDevice.userCode}
					verificationUri={copilotDevice.verificationUri}
				/>
			)}

			{!copilotDevice && isAwaitingAuth && authUrl && (
				<div className="px-3 pb-2.5 pt-0">
					<div className="flex items-center gap-1.5 text-xs">
						<StableSpinner
							size="xs"
							className="flex-shrink-0 text-yellow-500"
							title="Waiting for auth"
						/>
						<span className="text-yellow-500/80">Waiting for auth...</span>
						<a
							href={authUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(e) => {
								e.preventDefault();
								openUrl(authUrl);
							}}
							className="inline-flex items-center gap-0.5 text-yellow-400 hover:text-yellow-300 underline underline-offset-2"
						>
							Open login
							<ExternalLink className="w-3 h-3" />
						</a>
					</div>
				</div>
			)}

			{server.error && !server.connected && !isAwaitingAuth && (
				<div className="px-3 pb-2.5 pt-0">
					<div
						className="max-h-16 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400"
						title={server.error}
					>
						{server.error}
					</div>
				</div>
			)}

			{hasTools && showTools && (
				<div className="px-3 pb-2.5 pt-0">
					<div className="flex flex-wrap gap-1">
						{server.tools.map((tool) => (
							<span
								key={tool}
								className="text-xs bg-muted px-1.5 py-0.5 rounded"
								title={tool}
							>
								{tool.split('__').pop()}
							</span>
						))}
					</div>
				</div>
			)}
		</div>
	);
});

function useAuthPoller(name: string | null, onAuthenticated: () => void) {
	const { data } = useMCPAuthStatus(name);
	const prevAuth = useRef(false);

	useEffect(() => {
		if (data?.authenticated && !prevAuth.current) {
			onAuthenticated();
		}
		prevAuth.current = data?.authenticated ?? false;
	}, [data?.authenticated, onAuthenticated]);
}

export const MCPSidebar = memo(function MCPSidebar() {
	const isExpanded = useMCPStore((s) => s.isExpanded);
	return isExpanded ? <MCPSidebarContent /> : null;
});

const MCPSidebarContent = memo(function MCPSidebarContent() {
	const collapseSidebar = useMCPStore((s) => s.collapseSidebar);
	const servers = useMCPStore((s) => s.servers);
	const loading = useMCPStore((s) => s.loading);
	const authUrls = useMCPStore((s) => s.authUrls);
	const setAuthUrl = useMCPStore((s) => s.setAuthUrl);
	const setLoading = useMCPStore((s) => s.setLoading);
	const setCopilotDevice = useMCPStore((s) => s.setCopilotDevice);

	const { isLoading: isFetching } = useMCPServers();
	const startServer = useStartMCPServer();
	const stopServer = useStopMCPServer();
	const removeServer = useRemoveMCPServer();
	const authServer = useAuthenticateMCPServer();
	const copilotDevice = useCopilotDevicePoller();

	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<string | null>(null);
	const [pollingServer, setPollingServer] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');

	const queryClient = useQueryClient();

	const handleAuthCompleted = useCallback(() => {
		if (pollingServer) {
			setAuthUrl(pollingServer, null);
			setPollingServer(null);
			queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
		}
	}, [pollingServer, setAuthUrl, queryClient]);

	useAuthPoller(pollingServer, handleAuthCompleted);

	useEffect(() => {
		for (const name of loading) {
			const server = servers.find((s) => s.name === name);
			if (server?.connected) {
				setLoading(name, false);
			}
		}
	}, [servers, loading, setLoading]);

	const handleCopilotDeviceResponse = useCallback(
		(
			name: string,
			result: {
				sessionId?: string;
				userCode?: string;
				verificationUri?: string;
				interval?: number;
			},
		) => {
			if (result.sessionId && result.userCode && result.verificationUri) {
				setCopilotDevice({
					sessionId: result.sessionId,
					userCode: result.userCode,
					verificationUri: result.verificationUri,
					interval: result.interval ?? 5,
					serverName: name,
				});
				openUrl(result.verificationUri);
			}
		},
		[setCopilotDevice],
	);

	const handleAuth = useCallback(
		async (name: string) => {
			try {
				setLoading(name, true);
				const result = await authServer.mutateAsync(name);
				if (result.authType === 'copilot-device') {
					if (result.authenticated) {
						setLoading(name, false);
						queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] });
						return;
					}
					handleCopilotDeviceResponse(name, result);
				} else if (result.authUrl) {
					setAuthUrl(name, result.authUrl);
					setPollingServer(name);
					openUrl(result.authUrl);
				} else {
					setLoading(name, false);
				}
			} catch {
				setLoading(name, false);
				setAuthUrl(name, null);
			}
		},
		[
			authServer,
			setAuthUrl,
			setLoading,
			handleCopilotDeviceResponse,
			queryClient,
		],
	);

	const handleStart = useCallback(
		async (name: string) => {
			try {
				setLoading(name, true);
				const result = await startServer.mutateAsync(name);
				if (result.authType === 'copilot-device' && !result.connected) {
					handleCopilotDeviceResponse(name, result);
				} else if (result.authRequired && result.authUrl) {
					setAuthUrl(name, result.authUrl);
					setPollingServer(name);
					openUrl(result.authUrl);
				} else {
					setLoading(name, false);
				}
			} catch {
				setLoading(name, false);
				setAuthUrl(name, null);
			}
		},
		[startServer, setAuthUrl, setLoading, handleCopilotDeviceResponse],
	);

	const sortedServers = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		const filtered = q
			? servers.filter((s) => {
					const cmd = s.command ? `${s.command} ${s.args.join(' ')}` : '';
					return (
						s.name.toLowerCase().includes(q) ||
						(s.url ?? '').toLowerCase().includes(q) ||
						cmd.toLowerCase().includes(q)
					);
				})
			: servers;
		return [...filtered].sort((a, b) => {
			if (a.connected && !b.connected) return -1;
			if (!a.connected && b.connected) return 1;
			return a.name.localeCompare(b.name);
		});
	}, [servers, searchQuery]);

	const connectedCount = servers.filter((s) => s.connected).length;

	const deleteServer = deleteTarget
		? servers.find((s) => s.name === deleteTarget)
		: undefined;
	const editServer = editTarget
		? (servers.find((s) => s.name === editTarget) ?? null)
		: null;
	const deleteIsPluginManaged = deleteServer
		? isPluginManagedMcpServer(deleteServer)
		: false;

	return (
		<div className="w-full min-w-80 border-l border-sidebar-border sidebar-fade-in flex flex-col h-full">
			<SidebarHeader
				icon={<Plug className="size-[15px]" />}
				title={
					<>
						MCP Servers
						{connectedCount > 0 && (
							<span className="ml-2 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">
								{connectedCount} active
							</span>
						)}
					</>
				}
				onClose={collapseSidebar}
			>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => setIsAddModalOpen(true)}
					title="Add MCP server"
					className="h-7 w-7"
				>
					<Plus className="w-4 h-4" />
				</Button>
			</SidebarHeader>

			{servers.length > 0 && (
				<div className="px-2 py-2 border-b border-sidebar-border/60">
					<div className="relative">
						<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search servers..."
							className="w-full h-8 pl-7 pr-7 text-[12px] bg-muted/40 border border-sidebar-border/60 rounded-md outline-none focus:border-foreground/20 placeholder:text-muted-foreground"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery('')}
								className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
								title="Clear search"
							>
								<X className="w-3 h-3" />
							</button>
						)}
					</div>
				</div>
			)}

			<div className="flex-1 overflow-y-auto">
				{isFetching && servers.length === 0 ? (
					<div className="flex items-center justify-center h-32 text-muted-foreground">
						<StableSpinner className="mr-2" title="Loading MCP servers" />
						Loading...
					</div>
				) : servers.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground space-y-3">
						<p>No MCP servers configured.</p>
						<Button
							variant="primary"
							size="sm"
							onClick={() => setIsAddModalOpen(true)}
							className="w-full"
						>
							<Plus className="w-3 h-3 mr-1" />
							Add MCP Server
						</Button>
						<p className="text-xs">
							Or add servers to{' '}
							<code className="bg-muted px-1 py-0.5 rounded text-xs">
								.otto/config.json
							</code>
						</p>
					</div>
				) : sortedServers.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground text-center">
						No servers match "{searchQuery}".
					</div>
				) : (
					<div className="py-1">
						{sortedServers.map((server) => (
							<MCPServerCard
								key={server.name}
								server={server}
								isLoading={loading.has(server.name)}
								authUrl={authUrls.get(server.name)}
								copilotDevice={
									copilotDevice?.serverName === server.name
										? copilotDevice
										: null
								}
								onStart={() => handleStart(server.name)}
								onStop={() => stopServer.mutate(server.name)}
								onRemove={() => setDeleteTarget(server.name)}
								onEdit={() => setEditTarget(server.name)}
								onAuth={() => handleAuth(server.name)}
							/>
						))}
					</div>
				)}
			</div>

			<AddMCPServerModal
				isOpen={isAddModalOpen}
				onClose={() => setIsAddModalOpen(false)}
			/>

			<AddMCPServerModal
				isOpen={!!editServer}
				onClose={() => setEditTarget(null)}
				editServer={editServer}
			/>

			<Modal
				isOpen={!!deleteTarget}
				onClose={() => setDeleteTarget(null)}
				title={
					deleteIsPluginManaged
						? 'Disable Plugin MCP Server'
						: 'Remove MCP Server'
				}
				maxWidth="sm"
				showCloseButton={false}
			>
				<p className="text-sm text-muted-foreground mb-4">
					{deleteIsPluginManaged ? (
						<>
							<span className="font-medium text-foreground">
								{deleteTarget}
							</span>{' '}
							is provided by{' '}
							<span className="font-medium text-foreground">
								{deleteServer?.sourcePlugin
									? `plugin: ${deleteServer.sourcePlugin}`
									: 'a plugin'}
							</span>
							. This stops it and saves a project override that disables it,
							without changing the plugin. Re-enable it by removing the override
							or disabling the plugin.
						</>
					) : (
						<>
							Are you sure you want to remove{' '}
							<span className="font-medium text-foreground">
								{deleteTarget}
							</span>
							? This will stop the server and remove its configuration.
						</>
					)}
				</p>
				<div className="flex justify-end gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setDeleteTarget(null)}
					>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						className="bg-red-500 hover:bg-red-600 text-white"
						onClick={() => {
							if (deleteTarget) {
								removeServer.mutate(deleteTarget);
							}
							setDeleteTarget(null);
						}}
					>
						{deleteIsPluginManaged ? 'Disable' : 'Remove'}
					</Button>
				</div>
			</Modal>
		</div>
	);
});
