import { memo, useMemo } from 'react';
import {
	Box,
	Download,
	ExternalLink,
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

function sourceText(source: PluginRegistryEntry['source']) {
	if (!source) return 'inline registry metadata';
	if (source.type === 'github') {
		return `github:${source.repo}/${source.path}${source.ref ? `#${source.ref}` : ''}`;
	}
	return source.path;
}

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
			onClick={onToggle}
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

const CapabilityList = memo(function CapabilityList({
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
		<div className="space-y-2 border-t border-border/60 pt-3 text-xs">
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

	return (
		<article className="rounded-xl border border-border bg-background/70 p-4 shadow-sm">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-lg border border-border bg-muted/50 p-2 text-muted-foreground">
					<Puzzle className="h-4 w-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h3 className="truncate text-sm font-semibold text-foreground">
							{displayName}
						</h3>
						<span className="font-mono text-xs text-muted-foreground">
							{plugin.name}
						</span>
						{official ? (
							<Badge variant="success">
								<ShieldCheck className="h-3 w-3" /> Official
							</Badge>
						) : null}
						{plugin.status !== 'installed' ? (
							<Badge variant="warning">{plugin.status}</Badge>
						) : null}
					</div>
					{description ? (
						<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
							{description}
						</p>
					) : null}
				</div>
				<EnabledSwitch
					checked={plugin.enabled}
					disabled={pending}
					onToggle={() => onEnableToggle(plugin)}
				/>
			</div>

			<div className="mt-3 flex flex-wrap gap-2">
				<Badge>{plugin.scope}</Badge>
				<Badge>
					{formatPlatforms(manifest?.platforms ?? registry?.platforms)}
				</Badge>
				{installedVersion ? <Badge>Installed {installedVersion}</Badge> : null}
				{latestVersion ? (
					<Badge variant={hasUpdate ? 'warning' : 'default'}>
						Latest {latestVersion}
					</Badge>
				) : null}
				{plugin.overriddenByProject ? <Badge>Project override</Badge> : null}
			</div>

			<CapabilityList plugin={plugin} />

			<div className="mt-3 flex flex-wrap gap-2">
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
		</article>
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
	return (
		<article className="rounded-xl border border-border bg-muted/20 p-4">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-lg border border-border bg-background/70 p-2 text-muted-foreground">
					<PackageCheck className="h-4 w-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h3 className="truncate text-sm font-semibold text-foreground">
							{plugin.displayName ?? plugin.name}
						</h3>
						<span className="font-mono text-xs text-muted-foreground">
							{plugin.name}
						</span>
						{plugin.official ? (
							<Badge variant="success">
								<ShieldCheck className="h-3 w-3" /> Official
							</Badge>
						) : null}
						{installed && showInstalledState ? <Badge>Installed</Badge> : null}
					</div>
					{plugin.description ? (
						<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
							{plugin.description}
						</p>
					) : null}
				</div>
			</div>

			<div className="mt-3 flex flex-wrap gap-2">
				<Badge>Latest {plugin.version}</Badge>
				<Badge>{formatPlatforms(plugin.platforms)}</Badge>
				{plugin.publisher ? <Badge>{plugin.publisher}</Badge> : null}
				{plugin.tags?.map((tag) => (
					<Badge key={tag}>{tag}</Badge>
				))}
			</div>

			<div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<ExternalLink className="h-3.5 w-3.5" />
					<span className="break-all font-mono text-[11px]">
						{sourceText(plugin.source)}
					</span>
				</div>
			</div>

			{installed ? null : (
				<div className="mt-3 flex flex-wrap gap-2">
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
		</article>
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
					<div className="space-y-3">
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
					<div className="space-y-3">
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
