import { Check, Plug, PlugZap, X } from 'lucide-react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';

type ServerSummary = {
	name: string;
	transport?: string;
	scope?: string;
	disabled?: boolean;
	command?: string;
	args?: string[];
	url?: string;
	connected?: boolean;
	tools?: string[];
	error?: string;
};

function getString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function getServer(value: unknown): ServerSummary | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as ServerSummary)
		: null;
}

function getServers(value: unknown): ServerSummary[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is ServerSummary =>
			typeof item === 'object' &&
			item !== null &&
			typeof (item as ServerSummary).name === 'string',
	);
}

function getActionLabel(action: string | null): string {
	switch (action) {
		case 'list':
			return 'list servers';
		case 'add':
			return 'add server';
		case 'update':
			return 'update server';
		case 'remove':
			return 'remove server';
		case 'enable':
			return 'enable server';
		case 'disable':
			return 'disable server';
		default:
			return action?.replace(/_/g, ' ') || 'mcp manager';
	}
}

function ServerRow({ server }: { server: ServerSummary }) {
	const disabled = server.disabled === true;
	const connected = server.connected === true;
	const target = server.url ?? server.command;
	const toolCount = server.tools?.length ?? 0;
	return (
		<div className="flex items-center gap-1.5 text-[11px] min-w-0">
			{connected ? (
				<PlugZap className="h-3 w-3 flex-shrink-0 text-emerald-500" />
			) : (
				<Plug
					className={`h-3 w-3 flex-shrink-0 ${
						disabled ? 'text-foreground/30' : 'text-purple-400'
					}`}
				/>
			)}
			<span
				className={`font-mono ${
					disabled ? 'text-foreground/40 line-through' : 'text-foreground/70'
				}`}
			>
				{server.name}
			</span>
			<span className="text-muted-foreground/70 flex-shrink-0">·</span>
			<span className="text-foreground/50 flex-shrink-0">
				{server.transport ?? 'stdio'}
			</span>
			<span className="text-muted-foreground/70 flex-shrink-0">·</span>
			<span className="text-foreground/50 flex-shrink-0">
				{server.scope ?? 'global'}
			</span>
			{target && (
				<>
					<span className="text-muted-foreground/70 flex-shrink-0">·</span>
					<span className="truncate font-mono text-foreground/50">
						{target}
					</span>
				</>
			)}
			{connected && toolCount > 0 && (
				<>
					<span className="text-muted-foreground/70 flex-shrink-0">·</span>
					<span className="flex-shrink-0 text-emerald-600 dark:text-emerald-400">
						{toolCount} tool{toolCount !== 1 ? 's' : ''}
					</span>
				</>
			)}
			{server.error && (
				<>
					<span className="text-muted-foreground/70 flex-shrink-0">·</span>
					<span className="truncate text-red-500">{server.error}</span>
				</>
			)}
		</div>
	);
}

export function McpManagerRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const result = (contentJson.result || {}) as Record<string, unknown>;
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const timeStr = formatDuration(toolDurationMs);

	const action = getString(result.action) ?? getString(args.action);
	const hasError = result.ok === false;
	const errorMessage = getString(result.error);
	const startError = getString(result.startError);
	const servers = getServers(result.servers);
	const server = getServer(result.server);
	const removedName = getString(result.name) ?? getString(args.name);
	const isList = action === 'list';

	const detail = isList
		? `${servers.length} server${servers.length !== 1 ? 's' : ''}`
		: (server?.name ?? removedName);

	const hasContent =
		servers.length > 0 ||
		Boolean(server) ||
		Boolean(errorMessage) ||
		Boolean(startError) ||
		(action === 'remove' && Boolean(removedName));

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="mcp_manager"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="purple"
				canExpand={hasContent}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70">{getActionLabel(action)}</span>
					</>
				)}
				{detail && !compact && (
					<>
						<ToolHeaderSeparator />
						<span className="truncate font-mono text-[11px] text-foreground/60">
							{detail}
						</span>
					</>
				)}
				{!hasError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>ok</ToolHeaderSuccess>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
				{hasError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderError>error</ToolHeaderError>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasContent && (
				<div className="mt-1.5 ml-5 flex flex-col gap-1 text-[11px] text-foreground/70">
					{hasError && errorMessage && (
						<div className="flex items-center gap-1.5 text-red-500">
							<X className="h-3 w-3 flex-shrink-0" />
							<span>{errorMessage}</span>
						</div>
					)}
					{servers.map((item) => (
						<ServerRow key={item.name} server={item} />
					))}
					{server && <ServerRow server={server} />}
					{!hasError && action === 'remove' && removedName && (
						<div className="flex items-center gap-1.5">
							<Check className="h-3 w-3 flex-shrink-0 text-green-500" />
							<span>
								removed{' '}
								<span className="font-mono text-foreground/70">
									{removedName}
								</span>
							</span>
						</div>
					)}
					{startError && (
						<div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-300">
							<X className="h-3 w-3 flex-shrink-0" />
							<span>start failed: {startError}</span>
						</div>
					)}
					{isList && servers.length === 0 && !hasError && (
						<div className="text-foreground/50">No MCP servers configured</div>
					)}
				</div>
			)}
		</div>
	);
}
