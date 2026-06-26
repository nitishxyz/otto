import { memo, useMemo } from 'react';
import {
	Box,
	ChevronRight,
	Download,
	ExternalLink,
	FolderGit2,
	Github,
	Globe2,
	PackageCheck,
	Puzzle,
	RefreshCw,
	ShieldCheck,
	Terminal,
	Trash2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { StableSpinner } from '../ui/StableSpinner';
import {
	useDisablePlugin,
	useEnablePlugin,
	useInstallPlugin,
	usePluginRegistry,
	usePlugins,
	useRemovePlugin,
	useUpdatePlugin,
} from '../../hooks/usePlugins';
import { toast } from '../../stores/toastStore';
import type {
	EffectivePlugin,
	PluginCommand,
	PluginRegistryEntry,
	PluginScope,
} from '../../lib/api-client';

type Platform = 'darwin' | 'linux' | 'win32';

const PLATFORM_LABELS: Record<Platform, string> = {
	darwin: 'macOS',
	linux: 'Linux',
	win32: 'Windows',
};

function formatPlatforms(platforms?: Platform[]) {
	if (!platforms?.length) return 'All platforms';
	return platforms
		.map((platform) => PLATFORM_LABELS[platform] ?? platform)
		.join(', ');
}

function compareVersions(a?: string, b?: string) {
	if (!a || !b || a === b) return 0;
	const left = a.split(/[.-]/).map((part) => Number(part));
	const right = b.split(/[.-]/).map((part) => Number(part));
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const leftPart = Number.isFinite(left[index]) ? left[index] : 0;
		const rightPart = Number.isFinite(right[index]) ? right[index] : 0;
		if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
	}
	return a.localeCompare(b);
}

function commandText(command: PluginCommand) {
	return [command.command, ...(command.args ?? [])].join(' ');
}

function pluralize(count: number, noun: string) {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

interface CapabilitySource {
	skills?: unknown[];
	recipes?: unknown[];
	mcpServers?: Record<string, unknown>;
	commands?: Record<string, unknown>;
}

function capabilityCounts(source?: CapabilitySource): string[] {
	const skills = source?.skills?.length ?? 0;
	const recipes = source?.recipes?.length ?? 0;
	const mcp = Object.keys(source?.mcpServers ?? {}).length;
	const commands = Object.keys(source?.commands ?? {}).length;
	return [
		skills ? pluralize(skills, 'skill') : null,
		recipes ? pluralize(recipes, 'recipe') : null,
		mcp ? `${mcp} MCP` : null,
		commands ? pluralize(commands, 'command') : null,
	].filter((value): value is string => Boolean(value));
}

type PluginSource = PluginRegistryEntry['source'];

function sourceLabel(source: PluginSource) {
	if (!source) return 'inline registry metadata';
	if (source.type === 'github') return source.repo;
	return source.path;
}

function sourceUrl(source: PluginSource): string | undefined {
	if (source?.type !== 'github') return undefined;
	const ref = source.ref ?? 'main';
	const path = source.path ? `/tree/${ref}/${source.path}` : '';
	return `https://github.com/${source.repo}${path}`;
}

const SourceLink = memo(function SourceLink({
	source,
}: {
	source: PluginSource;
}) {
	const label = sourceLabel(source);
	const url = sourceUrl(source);
	const isGithub = source?.type === 'github';
	const Icon = isGithub ? Github : FolderGit2;

	if (!url) {
		return (
			<span className="inline-flex max-w-full items-center gap-1.5 text-[11px] text-muted-foreground">
				<Icon className="h-3.5 w-3.5 shrink-0" />
				<span className="truncate font-mono">{label}</span>
			</span>
		);
	}

	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer noopener"
			onClick={(event) => event.stopPropagation()}
			title={url}
			className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
		>
			<Icon className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate font-mono">{label}</span>
			<ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
		</a>
	);
});

interface BadgeProps {
	children: React.ReactNode;
	variant?: 'default' | 'success' | 'warning';
}

const Badge = memo(function Badge({
	children,
	variant = 'default',
}: BadgeProps) {
	const className =
		variant === 'success'
			? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
			: variant === 'warning'
				? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
				: 'border-border bg-muted/60 text-muted-foreground';
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
		>
			{children}
		</span>
	);
});

interface TagOverflowProps {
	tags?: string[];
	max?: number;
}

const TagOverflow = memo(function TagOverflow({
	tags,
	max = 4,
}: TagOverflowProps) {
	if (!tags?.length) return null;
	const visible = tags.slice(0, max);
	const hidden = tags.length - visible.length;
	return (
		<>
			{visible.map((tag) => (
				<Badge key={tag}>{tag}</Badge>
			))}
			{hidden > 0 ? (
				<Badge>
					<span title={tags.slice(max).join(', ')}>+{hidden}</span>
				</Badge>
			) : null}
		</>
	);
});

interface EnabledSwitchProps {
	checked: boolean;
	disabled: boolean;
	onToggle: () => void;
}

const EnabledSwitch = memo(function EnabledSwitch({
	checked,
	disabled,
	onToggle,
}: EnabledSwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onToggle();
			}}
			className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? 'bg-primary' : 'bg-muted'
			}`}
		>
			<span
				className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
					checked ? 'translate-x-6' : 'translate-x-1'
				} ${checked ? 'bg-primary-foreground' : 'bg-foreground'}`}
			/>
		</button>
	);
});

interface CapabilityListProps {
	plugin: EffectivePlugin;
}

const CapabilityGroups = memo(function CapabilityGroups({
	plugin,
}: CapabilityListProps) {
	const manifest = plugin.manifest;
	const skills = manifest?.skills ?? [];
	const recipes = manifest?.recipes ?? [];
	const mcpServers = Object.keys(manifest?.mcpServers ?? {});
	const commands = Object.entries(manifest?.commands ?? {});
	const requirements = manifest?.requirements ?? [];

	if (
		!skills.length &&
		!recipes.length &&
		!mcpServers.length &&
		!commands.length &&
		!requirements.length
	) {
		return null;
	}

	return (
		<div className="space-y-2 text-xs">
			{skills.length ? (
				<CapabilityGroup
					label="Skills"
					items={skills.map((skill) =>
						skill.description
							? `${skill.name} - ${skill.description}`
							: skill.name,
					)}
				/>
			) : null}
			{recipes.length ? (
				<CapabilityGroup
					label="Recipes"
					items={recipes.map((recipe) =>
						recipe.description
							? `${recipe.name} - ${recipe.description}`
							: recipe.name,
					)}
				/>
			) : null}
			{mcpServers.length ? (
				<CapabilityGroup label="MCP" items={mcpServers} />
			) : null}
			{commands.length ? (
				<CapabilityGroup
					label="Commands"
					items={commands.map(([name, command]) =>
						command.label
							? `${command.label}: ${commandText(command)}`
							: `${name}: ${commandText(command)}`,
					)}
				/>
			) : null}
			{requirements.length ? (
				<CapabilityGroup
					label="Requirements"
					items={requirements.map((requirement) =>
						requirement.message
							? `${requirement.kind}:${requirement.value} - ${requirement.message}`
							: `${requirement.kind}:${requirement.value}`,
					)}
				/>
			) : null}
		</div>
	);
});

interface CapabilityGroupProps {
	label: string;
	items: string[];
}

const CapabilityGroup = memo(function CapabilityGroup({
	label,
	items,
}: CapabilityGroupProps) {
	return (
		<div className="grid gap-1 sm:grid-cols-[88px_1fr]">
			<div className="font-medium text-muted-foreground">{label}</div>
			<div className="space-y-1 text-foreground/90">
				{items.map((item) => (
					<div
						key={item}
						className="break-words font-mono text-[11px] leading-relaxed"
					>
						{item}
					</div>
				))}
			</div>
		</div>
	);
});

interface InstalledPluginCardProps {
	plugin: EffectivePlugin;
	registry?: PluginRegistryEntry;
	pending: boolean;
	onEnableToggle: (plugin: EffectivePlugin) => void;
	onRemove: (plugin: EffectivePlugin) => void;
	onUpdate: (plugin: EffectivePlugin) => void;
}

const InstalledPluginCard = memo(function InstalledPluginCard({
	plugin,
	registry,
	pending,
	onEnableToggle,
	onRemove,
	onUpdate,
}: InstalledPluginCardProps) {
	const manifest = plugin.manifest;
	const displayName =
		manifest?.displayName ?? registry?.displayName ?? plugin.name;
	const description = manifest?.description ?? registry?.description;
	const installedVersion = plugin.configEntry?.version ?? manifest?.version;
	const latestVersion = registry?.version;
	const hasUpdate = compareVersions(installedVersion, latestVersion) < 0;
	const official =
		registry?.official || plugin.configEntry?.source?.startsWith('official:');
	const counts = capabilityCounts(plugin.manifest);

	return (
		<details className="group rounded-lg border border-border bg-background/70 open:bg-background/90 open:shadow-sm">
			<summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
				<Puzzle className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="truncate text-sm font-medium text-foreground">
					{displayName}
				</span>
				<span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
					{plugin.name}
				</span>
				{official ? (
					<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
				) : null}
				{plugin.status !== 'installed' ? (
					<Badge variant="warning">{plugin.status}</Badge>
				) : null}
				{hasUpdate ? <Badge variant="warning">Update</Badge> : null}
				<span className="ml-auto hidden truncate text-[11px] text-muted-foreground md:inline">
					{counts.join(' · ')}
				</span>
				<EnabledSwitch
					checked={plugin.enabled}
					disabled={pending}
					onToggle={() => onEnableToggle(plugin)}
				/>
				<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
			</summary>

			<div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-3">
				{description ? (
					<p className="text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}

				<div className="flex flex-wrap gap-1.5">
					<Badge>{plugin.scope}</Badge>
					<Badge>
						{formatPlatforms(manifest?.platforms ?? registry?.platforms)}
					</Badge>
					{installedVersion ? (
						<Badge>Installed {installedVersion}</Badge>
					) : null}
					{latestVersion ? (
						<Badge variant={hasUpdate ? 'warning' : 'default'}>
							Latest {latestVersion}
						</Badge>
					) : null}
					{plugin.overriddenByProject ? <Badge>Project override</Badge> : null}
				</div>

				<CapabilityGroups plugin={plugin} />

				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => onUpdate(plugin)}
						disabled={pending || !registry}
						className="gap-2"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						{hasUpdate ? 'Update' : 'Check Update'}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onRemove(plugin)}
						disabled={pending}
						className="gap-2 text-red-600 hover:text-red-600 dark:text-red-400"
					>
						<Trash2 className="h-3.5 w-3.5" /> Remove
					</Button>
				</div>
			</div>
		</details>
	);
});

interface AvailablePluginCardProps {
	plugin: PluginRegistryEntry;
	installed?: EffectivePlugin;
	pending: boolean;
	onInstall: (plugin: PluginRegistryEntry, scope: PluginScope) => void;
	showInstalledState?: boolean;
}

const AvailablePluginCard = memo(function AvailablePluginCard({
	plugin,
	installed,
	pending,
	onInstall,
	showInstalledState = false,
}: AvailablePluginCardProps) {
	const counts = capabilityCounts(plugin);
	return (
		<details className="group rounded-lg border border-border bg-muted/20 open:bg-muted/30">
			<summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
				<PackageCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="truncate text-sm font-medium text-foreground">
					{plugin.displayName ?? plugin.name}
				</span>
				<span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
					{plugin.name}
				</span>
				{plugin.official ? (
					<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
				) : null}
				{installed && showInstalledState ? (
					<Badge variant="success">Installed</Badge>
				) : null}
				<span className="ml-auto hidden truncate text-[11px] text-muted-foreground md:inline">
					{counts.join(' · ')}
				</span>
				<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
			</summary>

			<div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-3">
				{plugin.description ? (
					<p className="text-xs leading-relaxed text-muted-foreground">
						{plugin.description}
					</p>
				) : null}

				<div className="flex flex-wrap items-center gap-1.5">
					<Badge>v{plugin.version}</Badge>
					<Badge>{formatPlatforms(plugin.platforms)}</Badge>
					{plugin.publisher ? <Badge>{plugin.publisher}</Badge> : null}
					<TagOverflow tags={plugin.tags} max={4} />
				</div>

				<SourceLink source={plugin.source} />

				{installed ? null : (
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => onInstall(plugin, 'global')}
							disabled={pending}
							className="gap-2"
						>
							<Download className="h-3.5 w-3.5" /> Install Global
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onInstall(plugin, 'project')}
							disabled={pending}
							className="gap-2"
						>
							<Download className="h-3.5 w-3.5" /> Install Project
						</Button>
					</div>
				)}
			</div>
		</details>
	);
});

export function PluginsSettings() {
	const pluginsQuery = usePlugins();
	const registryQuery = usePluginRegistry();
	const installPlugin = useInstallPlugin();
	const removePlugin = useRemovePlugin();
	const enablePlugin = useEnablePlugin();
	const disablePlugin = useDisablePlugin();
	const updatePlugin = useUpdatePlugin();

	const registryByName = useMemo(() => {
		const entries = new Map<string, PluginRegistryEntry>();
		for (const plugin of registryQuery.data?.plugins ?? []) {
			entries.set(plugin.name, plugin);
		}
		return entries;
	}, [registryQuery.data?.plugins]);

	const installedByName = useMemo(() => {
		const entries = new Map<string, EffectivePlugin>();
		for (const plugin of pluginsQuery.data?.plugins ?? []) {
			entries.set(plugin.name, plugin);
		}
		return entries;
	}, [pluginsQuery.data?.plugins]);

	const availablePlugins = useMemo(
		() =>
			(registryQuery.data?.plugins ?? [])
				.filter(
					(plugin) => plugin.official || !installedByName.has(plugin.name),
				)
				.sort(
					(a, b) =>
						Number(b.official) - Number(a.official) ||
						a.name.localeCompare(b.name),
				),
		[installedByName, registryQuery.data?.plugins],
	);

	const pending =
		installPlugin.isPending ||
		removePlugin.isPending ||
		enablePlugin.isPending ||
		disablePlugin.isPending ||
		updatePlugin.isPending;
	const isLoading = pluginsQuery.isLoading || registryQuery.isLoading;
	const error = pluginsQuery.error ?? registryQuery.error;

	const handleInstall = async (
		plugin: PluginRegistryEntry,
		scope: PluginScope,
	) => {
		try {
			await installPlugin.mutateAsync({
				source: plugin.name,
				scope,
				enabled: true,
			});
			toast.success(`Installed ${plugin.name} in ${scope} scope.`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to install plugin.',
			);
		}
	};

	const handleRemove = async (plugin: EffectivePlugin) => {
		try {
			await removePlugin.mutateAsync({
				name: plugin.name,
				scope: plugin.scope,
			});
			toast.success(`Removed ${plugin.name} from ${plugin.scope} scope.`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to remove plugin.',
			);
		}
	};

	const handleEnableToggle = async (plugin: EffectivePlugin) => {
		try {
			const input = { name: plugin.name, scope: plugin.scope };
			if (plugin.enabled) {
				await disablePlugin.mutateAsync(input);
				toast.success(`Disabled ${plugin.name}.`);
				return;
			}
			await enablePlugin.mutateAsync(input);
			toast.success(`Enabled ${plugin.name}.`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to update plugin.',
			);
		}
	};

	const handleUpdate = async (plugin: EffectivePlugin) => {
		try {
			await updatePlugin.mutateAsync({
				name: plugin.name,
				scope: plugin.scope,
			});
			toast.success(`Updated ${plugin.name}.`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to update plugin.',
			);
		}
	};

	return (
		<div className="space-y-5 pb-16">
			<div className="grid gap-3 md:grid-cols-2">
				<ScopeSummary
					icon={<Globe2 className="h-4 w-4" />}
					label="Global Scope"
					path={pluginsQuery.data?.global.configPath}
					count={pluginsQuery.data?.global.plugins.length ?? 0}
				/>
				<ScopeSummary
					icon={<Terminal className="h-4 w-4" />}
					label="Project Scope"
					path={pluginsQuery.data?.project.configPath}
					count={pluginsQuery.data?.project.plugins.length ?? 0}
				/>
			</div>

			{isLoading ? (
				<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
					<StableSpinner title="Loading plugins" /> Loading plugins...
				</div>
			) : null}

			{error ? (
				<div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
					{error instanceof Error ? error.message : 'Failed to load plugins.'}
				</div>
			) : null}

			<section className="space-y-3">
				<div>
					<h3 className="text-sm font-semibold text-foreground">
						Installed Plugins
					</h3>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Effective plugins after global/project merge rules.
					</p>
				</div>
				{pluginsQuery.data?.plugins.length ? (
					<div className="space-y-2">
						{pluginsQuery.data.plugins.map((plugin) => (
							<InstalledPluginCard
								key={`${plugin.scope}:${plugin.name}`}
								plugin={plugin}
								registry={registryByName.get(plugin.name)}
								pending={pending}
								onEnableToggle={handleEnableToggle}
								onRemove={handleRemove}
								onUpdate={handleUpdate}
							/>
						))}
					</div>
				) : !isLoading ? (
					<EmptyState message="No plugins installed yet." />
				) : null}
			</section>

			<section className="space-y-3">
				<div>
					<h3 className="text-sm font-semibold text-foreground">
						Available Registry Plugins
					</h3>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Official plugins from configured registries. Installing only adds
						declarative capability metadata.
					</p>
				</div>
				{availablePlugins.length ? (
					<div className="space-y-2">
						{availablePlugins.map((plugin) => (
							<AvailablePluginCard
								key={plugin.name}
								plugin={plugin}
								installed={installedByName.get(plugin.name)}
								pending={pending}
								onInstall={handleInstall}
								showInstalledState
							/>
						))}
					</div>
				) : !isLoading ? (
					<EmptyState message="No registry plugins available." />
				) : null}
			</section>
		</div>
	);
}

interface ScopeSummaryProps {
	icon: React.ReactNode;
	label: string;
	path?: string;
	count: number;
}

const ScopeSummary = memo(function ScopeSummary({
	icon,
	label,
	path,
	count,
}: ScopeSummaryProps) {
	return (
		<div className="rounded-lg border border-border bg-muted/20 p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<span className="text-muted-foreground">{icon}</span>
				{label}
				<span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
					{count}
				</span>
			</div>
			<p
				className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
				title={path}
			>
				{path ?? 'Not loaded'}
			</p>
		</div>
	);
});

const EmptyState = memo(function EmptyState({ message }: { message: string }) {
	return (
		<div className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
			<Box className="mx-auto mb-2 h-5 w-5" />
			{message}
		</div>
	);
});
