import { useKeyboard } from '@opentui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
	listMcpServers,
	startMcpServer,
	stopMcpServer,
	addMcpServer,
	removeMcpServer,
	initiateMcpAuth,
	completeMcpAuth,
} from '@ottocode/api';
import { useTheme } from '../theme.ts';
import { ModalFrame, SelectRow } from './ModalFrame.tsx';

interface MCPServerInfo {
	name: string;
	transport: string;
	command?: string;
	args: string[];
	url?: string;
	disabled: boolean;
	connected: boolean;
	tools: string[];
	authRequired: boolean;
	authenticated: boolean;
	scope: 'global' | 'project';
	authType?: string;
}

interface CopilotDevice {
	sessionId: string;
	userCode: string;
	verificationUri: string;
	interval: number;
	serverName: string;
}

type MCPServerListResponse = {
	servers?: MCPServerInfo[];
};

type MCPMutationResponse = {
	ok?: boolean;
	error?: string;
	connected?: boolean;
	authRequired?: boolean;
	authenticated?: boolean;
	authUrl?: string;
	authType?: string;
	sessionId?: string;
	userCode?: string;
	verificationUri?: string;
	interval?: number;
	status?: string;
};

type View = 'list' | 'add' | 'confirm-delete' | 'tools';

interface MCPOverlayProps {
	onClose: () => void;
}

function openUrlExternal(url: string) {
	const cmd =
		process.platform === 'darwin'
			? ['open', url]
			: process.platform === 'win32'
				? ['cmd', '/c', 'start', url]
				: ['xdg-open', url];
	Bun.spawn(cmd);
}

async function copyToClipboard(text: string): Promise<void> {
	const cmd =
		process.platform === 'darwin'
			? 'pbcopy'
			: process.platform === 'win32'
				? 'clip'
				: 'xclip -selection clipboard';
	const proc = Bun.spawn(['sh', '-c', cmd], {
		stdin: 'pipe',
	});
	proc.stdin.write(text);
	proc.stdin.end();
	await proc.exited;
}

export function MCPOverlay({ onClose }: MCPOverlayProps) {
	const { colors } = useTheme();
	const [servers, setServers] = useState<MCPServerInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [busyServers, setBusyServers] = useState<Set<string>>(new Set());
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [view, setView] = useState<View>('list');
	const [copilotDevice, setCopilotDevice] = useState<CopilotDevice | null>(
		null,
	);
	const [copilotCopied, setCopilotCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [toolsServer, setToolsServer] = useState<MCPServerInfo | null>(null);

	const [addMode, setAddMode] = useState<'local' | 'remote'>('local');
	const [addName, setAddName] = useState('');
	const [addCommand, setAddCommand] = useState('');
	const [addUrl, setAddUrl] = useState('');
	const [addScope, setAddScope] = useState<'global' | 'project'>('global');
	const [addField, setAddField] = useState(0);

	const selectedIdxRef = useRef(selectedIdx);
	selectedIdxRef.current = selectedIdx;
	const serversRef = useRef(servers);
	serversRef.current = servers;
	const viewRef = useRef(view);
	viewRef.current = view;
	const copilotDeviceRef = useRef(copilotDevice);
	copilotDeviceRef.current = copilotDevice;
	const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchServers = useCallback(async () => {
		try {
			const { data } = await listMcpServers();
			const resp = data as MCPServerListResponse | undefined;
			if (resp?.servers) {
				setServers(resp.servers);
			}
		} catch {
			setError('Failed to load MCP servers');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchServers();
		const interval = setInterval(fetchServers, 8000);
		return () => clearInterval(interval);
	}, [fetchServers]);

	const showStatus = useCallback((msg: string) => {
		setStatusMsg(msg);
		setTimeout(() => setStatusMsg(null), 3000);
	}, []);

	const setBusy = useCallback((name: string, busy: boolean) => {
		setBusyServers((prev) => {
			const next = new Set(prev);
			if (busy) next.add(name);
			else next.delete(name);
			return next;
		});
	}, []);

	const stopCopilotPolling = useCallback(() => {
		if (pollerRef.current) {
			clearInterval(pollerRef.current);
			pollerRef.current = null;
		}
		setCopilotDevice(null);
		setCopilotCopied(false);
	}, []);

	useEffect(() => () => stopCopilotPolling(), [stopCopilotPolling]);

	const startCopilotPolling = useCallback(
		(device: CopilotDevice) => {
			setCopilotDevice(device);
			const pollMs = (device.interval || 5) * 1000 + 1000;
			pollerRef.current = setInterval(async () => {
				try {
					const { data } = await completeMcpAuth({
						path: { name: device.serverName },
						body: { sessionId: device.sessionId },
					});
					const result = data as MCPMutationResponse | undefined;
					if (result?.status === 'complete') {
						stopCopilotPolling();
						setBusy(device.serverName, false);
						showStatus(`${device.serverName} authenticated`);
						fetchServers();
					} else if (result?.status === 'error') {
						stopCopilotPolling();
						setBusy(device.serverName, false);
						setError(result.error || 'Auth failed');
					}
				} catch {
					stopCopilotPolling();
					setBusy(device.serverName, false);
				}
			}, pollMs);
		},
		[stopCopilotPolling, setBusy, showStatus, fetchServers],
	);

	const handleToggle = useCallback(
		async (server: MCPServerInfo) => {
			setError(null);
			setBusy(server.name, true);
			try {
				if (server.connected) {
					const { data, error: err } = await stopMcpServer({
						path: { name: server.name },
					});
					if (err) throw new Error('Failed to stop server');
					const result = data as MCPMutationResponse | undefined;
					if (!result?.ok) throw new Error(result?.error || 'Failed to stop');
					showStatus(`${server.name} stopped`);
				} else if (server.authRequired && !server.authenticated) {
					const { data, error: err } = await initiateMcpAuth({
						path: { name: server.name },
					});
					if (err) throw new Error('Failed to initiate auth');
					const result = data as MCPMutationResponse | undefined;
					if (!result?.ok) throw new Error(result?.error || 'Auth failed');

					if (result.authType === 'copilot-device') {
						if (result.authenticated) {
							showStatus(`${server.name} already authenticated`);
							setBusy(server.name, false);
							fetchServers();
							return;
						}
						if (result.sessionId && result.userCode && result.verificationUri) {
							const device: CopilotDevice = {
								sessionId: result.sessionId,
								userCode: result.userCode,
								verificationUri: result.verificationUri,
								interval: result.interval ?? 5,
								serverName: server.name,
							};
							startCopilotPolling(device);
							openUrlExternal(result.verificationUri);
							await copyToClipboard(result.userCode);
							setCopilotCopied(true);
							return;
						}
					} else if (result.authUrl) {
						openUrlExternal(result.authUrl);
						showStatus('Browser opened for auth');
						setBusy(server.name, false);
						return;
					}
				} else {
					const { data, error: err } = await startMcpServer({
						path: { name: server.name },
					});
					if (err) throw new Error('Failed to start server');
					const result = data as MCPMutationResponse | undefined;
					if (!result?.ok) throw new Error(result?.error || 'Failed to start');

					if (result.authType === 'copilot-device' && !result.connected) {
						if (result.sessionId && result.userCode && result.verificationUri) {
							const device: CopilotDevice = {
								sessionId: result.sessionId,
								userCode: result.userCode,
								verificationUri: result.verificationUri,
								interval: result.interval ?? 5,
								serverName: server.name,
							};
							startCopilotPolling(device);
							openUrlExternal(result.verificationUri);
							await copyToClipboard(result.userCode);
							setCopilotCopied(true);
							return;
						}
					} else if (result.authRequired && result.authUrl) {
						openUrlExternal(result.authUrl);
						showStatus('Browser opened for auth');
						setBusy(server.name, false);
						return;
					}

					showStatus(`${server.name} started`);
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Operation failed');
			} finally {
				setBusy(server.name, false);
				fetchServers();
			}
		},
		[setBusy, showStatus, fetchServers, startCopilotPolling],
	);

	const handleRemove = useCallback(async () => {
		const server = serversRef.current[selectedIdxRef.current];
		if (!server) return;
		setError(null);
		try {
			const { error: err } = await removeMcpServer({
				path: { name: server.name },
			});
			if (err) throw new Error('Failed to remove');
			showStatus(`${server.name} removed`);
			setView('list');
			fetchServers();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Remove failed');
			setView('list');
		}
	}, [showStatus, fetchServers]);

	const handleAdd = useCallback(async () => {
		setError(null);
		const name = addName.trim();
		if (!name) {
			setError('Name is required');
			return;
		}
		try {
			if (addMode === 'local') {
				const cmdStr = addCommand.trim();
				if (!cmdStr) {
					setError('Command is required');
					return;
				}
				const parts = cmdStr.split(/\s+/);
				await addMcpServer({
					body: {
						name,
						transport: 'stdio',
						command: parts[0],
						args: parts.slice(1),
						scope: addScope,
					},
				});
			} else {
				const urlStr = addUrl.trim();
				if (!urlStr) {
					setError('URL is required');
					return;
				}
				await addMcpServer({
					body: {
						name,
						transport: 'http',
						url: urlStr,
						scope: addScope,
					},
				});
			}
			showStatus(`${name} added`);
			setAddName('');
			setAddCommand('');
			setAddUrl('');
			setAddScope('global');
			setAddField(0);
			setView('list');
			fetchServers();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Add failed');
		}
	}, [
		addName,
		addCommand,
		addUrl,
		addMode,
		addScope,
		showStatus,
		fetchServers,
	]);

	const sortedServers = [...servers].sort((a, b) => {
		if (a.connected && !b.connected) return -1;
		if (!a.connected && b.connected) return 1;
		return a.name.localeCompare(b.name);
	});

	const termRows = process.stdout.rows ?? 40;
	const VISIBLE_ROWS = Math.max(5, termRows - 10);
	const [scrollOffset, setScrollOffset] = useState(0);

	const ensureVisible = useCallback(
		(idx: number) => {
			let offset = scrollOffset;
			if (idx < offset) offset = idx;
			else if (idx >= offset + VISIBLE_ROWS) offset = idx - VISIBLE_ROWS + 1;
			setScrollOffset(offset);
		},
		[scrollOffset, VISIBLE_ROWS],
	);

	useKeyboard((key) => {
		if (viewRef.current === 'add') {
			const totalFields = addMode === 'local' ? 4 : 4;
			if (key.name === 'escape') {
				setView('list');
				setError(null);
			} else if (key.name === 'tab' || key.name === 'down') {
				setAddField((f) => (f + 1) % totalFields);
			} else if (key.name === 'up') {
				setAddField((f) => (f - 1 + totalFields) % totalFields);
			} else if (key.name === 'return') {
				if (addField === totalFields - 1) {
					handleAdd();
				} else {
					setAddField((f) => (f + 1) % totalFields);
				}
			} else if (key.raw && !key.ctrl && !key.meta) {
				const ch = key.raw;
				if (ch.length === 1 || key.name === 'space') {
					const char = key.name === 'space' ? ' ' : ch;
					if (addField === 0) setAddName((v) => v + char);
					else if (addField === 1) {
						if (addMode === 'local') setAddCommand((v) => v + char);
						else setAddUrl((v) => v + char);
					}
				}
				if (key.name === 'backspace') {
					if (addField === 0) setAddName((v) => v.slice(0, -1));
					else if (addField === 1) {
						if (addMode === 'local') setAddCommand((v) => v.slice(0, -1));
						else setAddUrl((v) => v.slice(0, -1));
					} else if (addField === 2) {
						setAddMode((m) => (m === 'local' ? 'remote' : 'local'));
					} else if (addField === 3) {
						setAddScope((s) => (s === 'global' ? 'project' : 'global'));
					}
				}
			}
			if (addField === 2 && (key.name === 'left' || key.name === 'right')) {
				setAddMode((m) => (m === 'local' ? 'remote' : 'local'));
			}
			if (addField === 3 && (key.name === 'left' || key.name === 'right')) {
				setAddScope((s) => (s === 'global' ? 'project' : 'global'));
			}
			return;
		}

		if (viewRef.current === 'confirm-delete') {
			if (key.name === 'return' || key.raw === 'y' || key.raw === 'Y') {
				handleRemove();
			} else {
				setView('list');
			}
			return;
		}

		if (viewRef.current === 'tools') {
			if (key.name === 'escape' || key.name === 'return') {
				setToolsServer(null);
				setView('list');
			}
			return;
		}

		const list = serversRef.current;
		if (key.name === 'escape') {
			onClose();
		} else if (key.name === 'up' || (key.ctrl && key.name === 'k')) {
			const next =
				selectedIdxRef.current <= 0
					? list.length - 1
					: selectedIdxRef.current - 1;
			setSelectedIdx(next);
			ensureVisible(next);
		} else if (key.name === 'down' || (key.ctrl && key.name === 'j')) {
			const next =
				selectedIdxRef.current >= list.length - 1
					? 0
					: selectedIdxRef.current + 1;
			setSelectedIdx(next);
			ensureVisible(next);
		} else if (key.name === 'return' || key.name === 'space') {
			const server = sortedServers[selectedIdxRef.current];
			if (server) handleToggle(server);
		} else if (key.raw === 'a' || key.raw === 'A') {
			setView('add');
			setAddField(0);
			setError(null);
		} else if (key.raw === 'd' || key.raw === 'D' || key.name === 'delete') {
			if (sortedServers.length > 0) setView('confirm-delete');
		} else if (key.raw === 't' || key.raw === 'T') {
			const server = sortedServers[selectedIdxRef.current];
			if (server?.connected && server.tools.length > 0) {
				setToolsServer(server);
				setView('tools');
			}
		} else if (key.raw === 'c' || key.raw === 'C') {
			if (copilotDeviceRef.current) {
				copyToClipboard(copilotDeviceRef.current.userCode).then(() => {
					setCopilotCopied(true);
					setTimeout(() => setCopilotCopied(false), 2000);
				});
			}
		}
	});

	const connectedCount = servers.filter((s) => s.connected).length;
	const visibleServers = sortedServers.slice(
		scrollOffset,
		scrollOffset + VISIBLE_ROWS,
	);

	if (view === 'add') {
		return (
			<ModalFrame
				title="Add MCP Server"
				size="md"
				footer="tab/↑↓ fields · ↵ submit · esc cancel"
			>
				<box style={{ flexDirection: 'column', gap: 1 }}>
					<box style={{ flexDirection: 'column' }}>
						<text fg={addField === 0 ? colors.blue : colors.fgDark}>Name:</text>
						<box
							style={{
								border: true,
								borderStyle: 'rounded',
								borderColor: addField === 0 ? colors.blue : colors.border,
								height: 3,
								paddingLeft: 1,
							}}
						>
							<text fg={colors.fgBright}>
								{addName}
								{addField === 0 ? '▎' : ''}
							</text>
						</box>
					</box>

					<box style={{ flexDirection: 'column' }}>
						<text fg={addField === 1 ? colors.blue : colors.fgDark}>
							{addMode === 'local' ? 'Command:' : 'URL:'}
						</text>
						<box
							style={{
								border: true,
								borderStyle: 'rounded',
								borderColor: addField === 1 ? colors.blue : colors.border,
								height: 3,
								paddingLeft: 1,
							}}
						>
							<text fg={colors.fgBright}>
								{addMode === 'local' ? addCommand : addUrl}
								{addField === 1 ? '▎' : ''}
							</text>
						</box>
						<text fg={colors.fgDark}>
							{addMode === 'local'
								? 'e.g. npx -y @modelcontextprotocol/server-github'
								: 'e.g. https://mcp.linear.app/mcp'}
						</text>
					</box>

					<box style={{ flexDirection: 'row', gap: 2 }}>
						<text fg={addField === 2 ? colors.blue : colors.fgDark}>Type:</text>
						<text fg={addMode === 'local' ? colors.green : colors.fgDimmed}>
							{addMode === 'local' ? '● local (stdio)' : '○ local (stdio)'}
						</text>
						<text fg={addMode === 'remote' ? colors.green : colors.fgDimmed}>
							{addMode === 'remote' ? '● remote (http)' : '○ remote (http)'}
						</text>
						{addField === 2 && <text fg={colors.fgDark}>← → to switch</text>}
					</box>

					<box style={{ flexDirection: 'row', gap: 2 }}>
						<text fg={addField === 3 ? colors.blue : colors.fgDark}>
							Scope:
						</text>
						<text fg={addScope === 'global' ? colors.green : colors.fgDimmed}>
							{addScope === 'global' ? '● global' : '○ global'}
						</text>
						<text fg={addScope === 'project' ? colors.green : colors.fgDimmed}>
							{addScope === 'project' ? '● project' : '○ project'}
						</text>
						{addField === 3 && <text fg={colors.fgDark}>← → to switch</text>}
					</box>
				</box>

				{error && (
					<box style={{ marginTop: 1 }}>
						<text fg={colors.red}>{error}</text>
					</box>
				)}
			</ModalFrame>
		);
	}

	if (view === 'confirm-delete') {
		const target = sortedServers[selectedIdx];
		return (
			<ModalFrame
				title="Remove Server"
				size="sm"
				footer="y/↵ confirm · any key cancel"
			>
				<text fg={colors.fgMuted}>
					Remove <b>{target?.name}</b>?
				</text>
				<text fg={colors.fgDark}>
					This will stop and remove the configuration.
				</text>
			</ModalFrame>
		);
	}

	if (view === 'tools' && toolsServer) {
		return (
			<ModalFrame
				title={`${toolsServer.name} — Tools (${toolsServer.tools.length})`}
				size="md"
				fill
				footer="esc/↵ back"
			>
				<box
					style={{ flexDirection: 'column', overflow: 'hidden', flexGrow: 1 }}
				>
					{toolsServer.tools.map((tool) => (
						<box key={tool} style={{ flexDirection: 'row', height: 1 }}>
							<text fg={colors.fgDimmed}> •</text>
							<text fg={colors.fgMuted}> {tool.split('__').pop()}</text>
							<text fg={colors.fgDark}> ({tool})</text>
						</box>
					))}
				</box>
			</ModalFrame>
		);
	}

	return (
		<ModalFrame
			title="MCP Servers"
			size="lg"
			fill
			footer="↑↓ nav · ↵ toggle · a add · d del · t tools · esc close"
		>
			<box style={{ flexDirection: 'row', gap: 2, marginBottom: 1 }}>
				<text fg={colors.fgMuted}>
					{servers.length} server{servers.length !== 1 ? 's' : ''}
				</text>
				{connectedCount > 0 && (
					<text fg={colors.green}>{connectedCount} active</text>
				)}
				{statusMsg && <text fg={colors.green}>{statusMsg}</text>}
				{error && <text fg={colors.red}>{error}</text>}
			</box>

			{copilotDevice && (
				<box
					style={{
						border: true,
						borderStyle: 'rounded',
						borderColor: colors.yellow,
						padding: 1,
						marginBottom: 1,
						flexDirection: 'column',
					}}
				>
					<box style={{ flexDirection: 'row', gap: 1 }}>
						<text fg={colors.yellow}>⟳ GitHub Device Auth for</text>
						<text fg={colors.fgBright}>
							<b>{copilotDevice.serverName}</b>
						</text>
					</box>
					<box style={{ flexDirection: 'row', gap: 1, marginTop: 0 }}>
						<text fg={colors.fgDark}>Enter code:</text>
						<text fg={colors.yellow}>
							<b>{copilotDevice.userCode}</b>
						</text>
						{copilotCopied && <text fg={colors.green}>copied!</text>}
					</box>
					<text fg={colors.fgDark}>
						Browser opened to {copilotDevice.verificationUri}
					</text>
					<text fg={colors.fgDimmed}>c copy code — waiting for auth…</text>
				</box>
			)}

			{loading && servers.length === 0 && (
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<spinner name="dots" color={colors.blue} />
					<text fg={colors.fgDark}>Loading servers…</text>
				</box>
			)}

			{!loading && servers.length === 0 && (
				<box style={{ flexDirection: 'column', gap: 1 }}>
					<text fg={colors.fgDark}>No MCP servers configured.</text>
					<text fg={colors.fgDimmed}>Press 'a' to add a server.</text>
				</box>
			)}

			{sortedServers.length > 0 && (
				<box
					style={{ flexDirection: 'column', overflow: 'hidden', flexGrow: 1 }}
				>
					{visibleServers.map((server, vi) => {
						const idx = scrollOffset + vi;
						const isSelected = idx === selectedIdx;
						const isBusy = busyServers.has(server.name);
						const isRemote =
							server.transport === 'http' || server.transport === 'sse';
						const toolCount = server.tools.length;

						const state = server.connected
							? 'connected'
							: server.authRequired && !server.authenticated
								? 'auth required'
								: 'disconnected';
						const footer = `${isRemote ? server.transport : 'stdio'}${
							server.scope === 'project' ? ' project' : ''
						}${server.connected && toolCount > 0 ? ` ${toolCount} tools` : ''}`;

						return (
							<SelectRow
								key={server.name}
								active={isSelected}
								title={server.name}
								description={isBusy ? 'working…' : state}
								footer={footer}
								gutter={
									isBusy ? (
										<spinner name="dots" color={colors.yellow} />
									) : server.connected ? (
										<text fg={colors.green}>●</text>
									) : server.authRequired && !server.authenticated ? (
										<text fg={colors.yellow}>◎</text>
									) : (
										<text fg={colors.fgDark}>○</text>
									)
								}
							/>
						);
					})}
				</box>
			)}
		</ModalFrame>
	);
}
