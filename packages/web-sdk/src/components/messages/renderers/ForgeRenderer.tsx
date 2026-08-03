import {
	Bot,
	Box,
	Check,
	ExternalLink,
	FileText,
	Hammer,
	Plug,
	TerminalSquare,
	Wrench,
	X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderError,
	ToolHeaderMeta,
	ToolHeaderSeparator,
	ToolHeaderSuccess,
} from './shared';

type UnknownRecord = Record<string, unknown>;

function getRecord(value: unknown): UnknownRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as UnknownRecord)
		: null;
}

function getRecords(value: unknown): UnknownRecord[] {
	return Array.isArray(value)
		? value.filter((item): item is UnknownRecord => Boolean(getRecord(item)))
		: [];
}

function getString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function getBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function getStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function getActionLabel(action: string | null, kind: string | null): string {
	if (kind === 'plugin-command') return 'run plugin command';
	if (kind === 'mcp-server' && action === 'execute') return 'run MCP lifecycle';
	if (!action) return 'manage capabilities';
	return action.replaceAll('-', ' ');
}

function getKindLabel(kind: string | null): string {
	if (!kind) return 'capability';
	return kind.replaceAll('-', ' ');
}

function getKindIcon(kind: string | null) {
	switch (kind) {
		case 'recipe':
			return FileText;
		case 'skill':
			return Wrench;
		case 'agent':
			return Bot;
		case 'mcp-server':
			return Plug;
		case 'plugin-command':
			return TerminalSquare;
		default:
			return Box;
	}
}

function CountBadge({ label, count }: { label: string; count: number }) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-4 rounded-md border border-border/70 bg-card/50 px-2.5 py-1.5">
			<span className="truncate text-foreground/60">{label}</span>
			<span className="font-mono text-foreground/80">{count}</span>
		</div>
	);
}

function DetailRow({
	icon,
	label,
	value,
}: {
	icon?: ReactNode;
	label: string;
	value: ReactNode;
}) {
	return (
		<div className="flex min-w-0 items-start gap-2 text-[11px]">
			<span className="mt-0.5 flex h-3 w-3 flex-shrink-0 items-center justify-center text-foreground/40">
				{icon}
			</span>
			<span className="flex-shrink-0 text-foreground/45">{label}</span>
			<div className="min-w-0 break-words text-foreground/75">{value}</div>
		</div>
	);
}

function InventoryDetails({ inventory }: { inventory: UnknownRecord }) {
	const recipes = getRecords(inventory.recipes);
	const skills = getRecords(inventory.skills);
	const agents = getRecords(inventory.agents);
	const mcpServers = getRecords(inventory.mcpServers);
	const plugins = getRecords(inventory.plugins);
	return (
		<div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
			<CountBadge label="recipes" count={recipes.length} />
			<CountBadge label="skills" count={skills.length} />
			<CountBadge label="agents" count={agents.length} />
			<CountBadge label="MCP servers" count={mcpServers.length} />
			<CountBadge label="plugins" count={plugins.length} />
		</div>
	);
}

function MutationDetails({ result }: { result: UnknownRecord }) {
	const plan = getRecord(result.plan);
	if (!plan) return null;
	const target = getRecord(plan.target);
	const paths = getStrings(target?.paths);
	const changes = getStrings(plan.changes);
	const preview = getString(plan.preview);
	return (
		<div className="flex flex-col gap-1.5">
			{changes.map((change) => (
				<DetailRow
					key={change}
					icon={<Check className="h-3 w-3 text-emerald-500" />}
					label="change"
					value={change}
				/>
			))}
			{paths.map((path) => (
				<DetailRow
					key={path}
					icon={<FileText className="h-3 w-3" />}
					label="path"
					value={<span className="font-mono">{path}</span>}
				/>
			))}
			{preview && (
				<div className="mt-1 max-h-64 overflow-auto rounded-md border border-border/70 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words text-foreground/65">
					{preview}
				</div>
			)}
		</div>
	);
}

function MCPDetails({ result }: { result: UnknownRecord }) {
	const server = getRecord(result.server);
	if (!server) return <MutationDetails result={result} />;
	const tools = getStrings(server.tools);
	const target = getString(server.url) ?? getString(server.command);
	const authUrl = getString(server.authUrl);
	const startError = getString(result.startError);
	return (
		<div className="flex flex-col gap-1.5">
			<DetailRow
				icon={<Plug className="h-3 w-3" />}
				label="server"
				value={
					<span className="font-mono">
						{getString(server.name) ?? 'unknown'} ·{' '}
						{getString(server.transport) ?? 'stdio'} ·{' '}
						{getString(server.scope) ?? 'global'}
					</span>
				}
			/>
			{target && (
				<DetailRow
					label="target"
					value={<span className="font-mono">{target}</span>}
				/>
			)}
			<DetailRow
				label="status"
				value={
					getBoolean(server.disabled) === true
						? 'disabled'
						: getBoolean(server.connected) === true
							? 'connected'
							: 'configured'
				}
			/>
			{tools.length > 0 && <DetailRow label="tools" value={tools.join(', ')} />}
			{authUrl && (
				<a
					href={authUrl}
					target="_blank"
					rel="noreferrer"
					className="flex min-w-0 items-center gap-1.5 text-purple-600 hover:underline dark:text-purple-300"
				>
					<ExternalLink className="h-3 w-3 flex-shrink-0" />
					<span className="truncate">Authorize MCP server</span>
				</a>
			)}
			{startError && (
				<DetailRow
					icon={<X className="h-3 w-3 text-amber-500" />}
					label="start error"
					value={startError}
				/>
			)}
			<MutationDetails result={result} />
		</div>
	);
}

function PluginCommandDetails({ result }: { result: UnknownRecord }) {
	const previewUrl = getString(result.previewUrl);
	return (
		<div className="flex flex-col gap-1.5">
			{getString(result.renderedCommand) && (
				<DetailRow
					icon={<TerminalSquare className="h-3 w-3" />}
					label="command"
					value={
						<span className="font-mono">
							{getString(result.renderedCommand)}
						</span>
					}
				/>
			)}
			{getString(result.terminalId) && (
				<DetailRow
					label="terminal"
					value={
						<span className="font-mono">{getString(result.terminalId)}</span>
					}
				/>
			)}
			{getString(result.execution) && (
				<DetailRow label="execution" value={getString(result.execution)} />
			)}
			{previewUrl && (
				<a
					href={previewUrl}
					target="_blank"
					rel="noreferrer"
					className="flex min-w-0 items-center gap-1.5 text-amber-600 hover:underline dark:text-amber-300"
				>
					<ExternalLink className="h-3 w-3 flex-shrink-0" />
					<span className="truncate">Open preview</span>
				</a>
			)}
			{getString(result.fallbackCommand) && (
				<DetailRow
					label="fallback"
					value={
						<span className="font-mono">
							{getString(result.fallbackCommand)}
						</span>
					}
				/>
			)}
		</div>
	);
}

export function ForgeRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const args = (contentJson.args || {}) as UnknownRecord;
	const result = (contentJson.result || {}) as UnknownRecord;
	const action = getString(args.action);
	const kind = getString(args.kind);
	const inventory = getRecord(result.inventory);
	const plan = getRecord(result.plan);
	const target = getRecord(plan?.target);
	const effectiveKind = kind ?? getString(target?.kind);
	const effectiveAction = action ?? getString(plan?.action);
	const name =
		getString(args.name) ??
		getString(target?.name) ??
		(kind === 'plugin-command'
			? [getString(args.plugin), getString(args.commandName)]
					.filter(Boolean)
					.join(' ')
			: null);
	const hasError = Boolean(contentJson.error) || result.ok === false;
	const applied = getBoolean(result.applied);
	const operation = getString(result.operation);
	const status = hasError
		? 'error'
		: inventory
			? 'ready'
			: applied === false || action === 'plan'
				? 'planned'
				: (getString(result.execution) ?? operation ?? 'done');
	const counts = inventory
		? [
				getRecords(inventory.recipes).length,
				getRecords(inventory.skills).length,
				getRecords(inventory.agents).length,
				getRecords(inventory.mcpServers).length,
				getRecords(inventory.plugins).length,
			].reduce((sum, count) => sum + count, 0)
		: null;
	const detail = inventory
		? `${counts} capabilities`
		: name || operation || getKindLabel(effectiveKind);
	const hasContent =
		hasError ||
		Boolean(inventory) ||
		Boolean(plan) ||
		Boolean(getRecord(result.server)) ||
		Boolean(getString(result.renderedCommand));
	const KindIcon = getKindIcon(effectiveKind);
	const timeStr = formatDuration(toolDurationMs);

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="forge"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="amber"
				canExpand={hasContent}
			>
				<Hammer className="h-3 w-3 flex-shrink-0" />
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span className="flex-shrink-0 text-foreground/70">
							{inventory
								? 'inventory'
								: getActionLabel(effectiveAction, effectiveKind)}
						</span>
					</>
				)}
				{detail && !compact && (
					<>
						<ToolHeaderSeparator />
						<KindIcon className="h-3 w-3 flex-shrink-0 text-foreground/45" />
						<span className="min-w-0 truncate font-mono text-[11px] text-foreground/60">
							{detail}
						</span>
					</>
				)}
				{!compact && (
					<>
						<ToolHeaderSeparator />
						{hasError ? (
							<ToolHeaderError>{status}</ToolHeaderError>
						) : (
							<ToolHeaderSuccess>{status}</ToolHeaderSuccess>
						)}
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasContent && (
				<div className="mt-1.5 ml-5 flex max-w-full flex-col gap-2 text-[11px] text-foreground/70">
					{hasError && (
						<div className="flex items-start gap-1.5 text-red-500">
							<X className="mt-0.5 h-3 w-3 flex-shrink-0" />
							<span className="break-words">
								{getString(result.error) ??
									getString(contentJson.error) ??
									'Forge operation failed'}
							</span>
						</div>
					)}
					{inventory && <InventoryDetails inventory={inventory} />}
					{effectiveKind === 'mcp-server' && !inventory && (
						<MCPDetails result={result} />
					)}
					{effectiveKind === 'plugin-command' && (
						<PluginCommandDetails result={result} />
					)}
					{effectiveKind !== 'mcp-server' &&
						effectiveKind !== 'plugin-command' &&
						!inventory && <MutationDetails result={result} />}
					{!hasError && !inventory && !plan && !getRecord(result.server) && (
						<div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
							<Check className="h-3 w-3" />
							<span>Forge operation complete</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export const forgeRendererHelpers = {
	getActionLabel,
	getKindLabel,
};
