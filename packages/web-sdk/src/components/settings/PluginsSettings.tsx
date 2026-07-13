import { memo, useMemo, useState } from 'react';
import {
	Download,
	ExternalLink,
	FolderGit2,
	Github,
	PackageCheck,
	Puzzle,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { StableSpinner } from '../ui/StableSpinner';
import {
	EntityEditor,
	EntityEmptyState,
	EntityListGroup,
	EntityListPage,
	EntityRow,
	SegmentedControl,
} from './SettingsEntityPage';
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
	dependencies?: unknown[];
	mcpServers?: Record<string, unknown>;
	commands?: Record<string, unknown>;
}

function capabilityCounts(source?: CapabilitySource): string[] {
	const skills = source?.skills?.length ?? 0;
	const recipes = source?.recipes?.length ?? 0;
	const dependencies = source?.dependencies?.length ?? 0;
	const mcp = Object.keys(source?.mcpServers ?? {}).length;
	const commands = Object.keys(source?.commands ?? {}).length;
	return [
		skills ? pluralize(skills, 'skill') : null,
		recipes ? pluralize(recipes, 'recipe') : null,
		dependencies ? pluralize(dependencies, 'dep') : null,
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
			title={url}
			className="inline-flex max-w-full items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
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
				: 'border-border/70 text-muted-foreground';
	return (
		<span
			className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium ${className}`}
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
		// biome-ignore lint/a11y/noStaticElementInteractions: stops row navigation when toggling
		<span
			role="presentation"
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
			className="flex shrink-0 items-center"
		>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={onToggle}
				className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
					checked ? 'bg-primary' : 'bg-muted'
				}`}
			>
				<span
					className={`inline-block h-3.5 w-3.5 transform rounded-full transition-transform ${
						checked ? 'translate-x-[18px]' : 'translate-x-1'
					} ${checked ? 'bg-primary-foreground' : 'bg-foreground'}`}
				/>
			</button>
		</span>
	);
});

interface DetailSectionProps {
	label: string;
	children: React.ReactNode;
}

const DetailSection = memo(function DetailSection({
	label,
	children,
}: DetailSectionProps) {
	return (
		<section>
			<h4 className="pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
				{label}
			</h4>
			{children}
		</section>
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
	const dependencies = manifest?.dependencies ?? [];
	const mcpServers = Object.keys(manifest?.mcpServers ?? {});
	const commands = Object.entries(manifest?.commands ?? {});
	const requirements = manifest?.requirements ?? [];

	if (
		!skills.length &&
		!recipes.length &&
		!dependencies.length &&
		!mcpServers.length &&
		!commands.length &&
		!requirements.length
	) {
		return null;
	}

	return (
		<DetailSection label="Capabilities">
			<div className="space-y-2 text-xs">
				{dependencies.length ? (
					<CapabilityGroup label="Depends on" items={dependencies} />
				) : null}
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
		</DetailSection>
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

type PluginsView = 'installed' | 'available';

type Selection =
	| { kind: 'installed'; key: string }
	| { kind: 'available'; name: string };

function installedKey(plugin: EffectivePlugin) {
	return `${plugin.scope}:${plugin.name}`;
}

export function PluginsSettings() {
	const pluginsQuery = usePlugins();
	const registryQuery = usePluginRegistry();
	const installPlugin = useInstallPlugin();
	const removePlugin = useRemovePlugin();
	const enablePlugin = useEnablePlugin();
	const disablePlugin = useDisablePlugin();
	const updatePlugin = useUpdatePlugin();
	const [view, setView] = useState<PluginsView>('installed');
	const [selection, setSelection] = useState<Selection | null>(null);

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

	const installedPlugins = pluginsQuery.data?.plugins ?? [];
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
			const depCount = plugin.dependencies?.length ?? 0;
			const withDeps = depCount
				? ` with ${depCount} ${depCount === 1 ? 'dependency' : 'dependencies'}`
				: '';
			toast.success(`Installed ${plugin.name}${withDeps} in ${scope} scope.`);
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
			setSelection(null);
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

	const selectedInstalled =
		selection?.kind === 'installed'
			? installedPlugins.find(
					(plugin) => installedKey(plugin) === selection.key,
				)
			: undefined;
	const selectedAvailable =
		selection?.kind === 'available'
			? registryByName.get(selection.name)
			: undefined;

	if (selectedInstalled) {
		return (
			<InstalledPluginDetail
				plugin={selectedInstalled}
				registry={registryByName.get(selectedInstalled.name)}
				pending={pending}
				onBack={() => setSelection(null)}
				onEnableToggle={handleEnableToggle}
				onRemove={handleRemove}
				onUpdate={handleUpdate}
			/>
		);
	}

	if (selectedAvailable) {
		return (
			<AvailablePluginDetail
				plugin={selectedAvailable}
				installed={installedByName.get(selectedAvailable.name)}
				pending={pending}
				onBack={() => setSelection(null)}
				onInstall={handleInstall}
			/>
		);
	}

	const globalCount = pluginsQuery.data?.global.plugins.length ?? 0;
	const projectCount = pluginsQuery.data?.project.plugins.length ?? 0;
	const scopeHint = [
		`Global (${globalCount}): ${pluginsQuery.data?.global.configPath ?? 'not loaded'}`,
		`Project (${projectCount}): ${pluginsQuery.data?.project.configPath ?? 'not loaded'}`,
	].join('\n');

	return (
		<EntityListPage
			toolbar={
				<>
					<SegmentedControl
						value={view}
						options={[
							{ value: 'installed', label: 'Installed' },
							{ value: 'available', label: 'Available' },
						]}
						onChange={(value) => setView(value)}
					/>
					<span className="text-xs text-muted-foreground" title={scopeHint}>
						{view === 'installed'
							? `${installedPlugins.length} effective · ${globalCount} global, ${projectCount} project`
							: `${availablePlugins.length} in registry`}
					</span>
				</>
			}
			hint={scopeHint}
		>
			{isLoading ? (
				<div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5">
					<StableSpinner title="Loading plugins" /> Loading plugins…
				</div>
			) : error ? (
				<div className="px-4 py-6 text-sm text-red-600 dark:text-red-400 sm:px-5">
					{error instanceof Error ? error.message : 'Failed to load plugins.'}
				</div>
			) : view === 'installed' ? (
				installedPlugins.length ? (
					<EntityListGroup>
						{installedPlugins.map((plugin) => {
							const registry = registryByName.get(plugin.name);
							const displayName =
								plugin.manifest?.displayName ??
								registry?.displayName ??
								plugin.name;
							const installedVersion =
								plugin.configEntry?.version ?? plugin.manifest?.version;
							const hasUpdate =
								compareVersions(installedVersion, registry?.version) < 0;
							return (
								<EntityRow
									key={installedKey(plugin)}
									onClick={() =>
										setSelection({
											kind: 'installed',
											key: installedKey(plugin),
										})
									}
									title={displayName}
									badge={plugin.scope}
									warning={
										plugin.status !== 'installed'
											? plugin.status
											: hasUpdate
												? `Update available (${registry?.version})`
												: undefined
									}
									description={
										plugin.manifest?.description ?? registry?.description
									}
									meta={capabilityCounts(plugin.manifest).join(' · ')}
									end={
										<EnabledSwitch
											checked={plugin.enabled}
											disabled={pending}
											onToggle={() => handleEnableToggle(plugin)}
										/>
									}
								/>
							);
						})}
					</EntityListGroup>
				) : (
					<EntityEmptyState
						icon={<Puzzle className="h-4 w-4" />}
						title="No plugins installed"
						description="Plugins add skills, recipes, MCP servers, and commands. Browse the registry to install one."
						actionLabel="Browse registry"
						onAction={() => setView('available')}
					/>
				)
			) : availablePlugins.length ? (
				<EntityListGroup>
					{availablePlugins.map((plugin) => {
						const installed = installedByName.get(plugin.name);
						return (
							<EntityRow
								key={plugin.name}
								onClick={() =>
									setSelection({ kind: 'available', name: plugin.name })
								}
								title={
									<span className="inline-flex items-center gap-1.5">
										{plugin.displayName ?? plugin.name}
										{plugin.official ? (
											<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
										) : null}
									</span>
								}
								badge={installed ? 'Installed' : undefined}
								description={plugin.description}
								meta={`v${plugin.version}`}
							/>
						);
					})}
				</EntityListGroup>
			) : (
				<EntityEmptyState
					icon={<PackageCheck className="h-4 w-4" />}
					title="No registry plugins"
					description="No plugins are available from configured registries."
				/>
			)}
		</EntityListPage>
	);
}

interface InstalledPluginDetailProps {
	plugin: EffectivePlugin;
	registry?: PluginRegistryEntry;
	pending: boolean;
	onBack: () => void;
	onEnableToggle: (plugin: EffectivePlugin) => void;
	onRemove: (plugin: EffectivePlugin) => void;
	onUpdate: (plugin: EffectivePlugin) => void;
}

function InstalledPluginDetail({
	plugin,
	registry,
	pending,
	onBack,
	onEnableToggle,
	onRemove,
	onUpdate,
}: InstalledPluginDetailProps) {
	const manifest = plugin.manifest;
	const displayName =
		manifest?.displayName ?? registry?.displayName ?? plugin.name;
	const description = manifest?.description ?? registry?.description;
	const installedVersion = plugin.configEntry?.version ?? manifest?.version;
	const latestVersion = registry?.version;
	const hasUpdate = compareVersions(installedVersion, latestVersion) < 0;
	const official =
		registry?.official || plugin.configEntry?.source?.startsWith('official:');
	const installedBy = plugin.configEntry?.installedBy ?? [];

	return (
		<EntityEditor
			backLabel="All plugins"
			onBack={onBack}
			title={displayName}
			subtitle={`${plugin.name} · ${plugin.scope} scope`}
			footerStart={
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onRemove(plugin)}
					disabled={pending}
					className="h-7 gap-1 px-2 text-xs text-red-500 hover:text-red-400"
				>
					<Trash2 className="h-3.5 w-3.5" /> Remove
				</Button>
			}
			footerEnd={
				<>
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						Enabled
						<EnabledSwitch
							checked={plugin.enabled}
							disabled={pending}
							onToggle={() => onEnableToggle(plugin)}
						/>
					</span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => onUpdate(plugin)}
						disabled={pending || !registry}
						className="h-7 gap-1.5 px-2.5 text-xs"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						{hasUpdate ? 'Update' : 'Check update'}
					</Button>
				</>
			}
		>
			{description ? (
				<p className="text-xs leading-relaxed text-muted-foreground">
					{description}
				</p>
			) : null}
			<div className="flex flex-wrap gap-1.5">
				{official ? (
					<Badge variant="success">
						<ShieldCheck className="h-3 w-3" /> Official
					</Badge>
				) : null}
				{plugin.status !== 'installed' ? (
					<Badge variant="warning">{plugin.status}</Badge>
				) : null}
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
				{installedBy.length ? (
					<Badge>
						<span
							title={`Installed as a dependency of ${installedBy.join(', ')}`}
						>
							Dependency of {installedBy.join(', ')}
						</span>
					</Badge>
				) : null}
			</div>
			<CapabilityGroups plugin={plugin} />
			{registry?.source ? (
				<DetailSection label="Source">
					<SourceLink source={registry.source} />
				</DetailSection>
			) : null}
		</EntityEditor>
	);
}

interface AvailablePluginDetailProps {
	plugin: PluginRegistryEntry;
	installed?: EffectivePlugin;
	pending: boolean;
	onBack: () => void;
	onInstall: (plugin: PluginRegistryEntry, scope: PluginScope) => void;
}

function AvailablePluginDetail({
	plugin,
	installed,
	pending,
	onBack,
	onInstall,
}: AvailablePluginDetailProps) {
	return (
		<EntityEditor
			backLabel="All plugins"
			onBack={onBack}
			title={plugin.displayName ?? plugin.name}
			subtitle={`${plugin.name} · v${plugin.version}`}
			footerEnd={
				installed ? (
					<Badge variant="success">
						<PackageCheck className="h-3 w-3" /> Installed
					</Badge>
				) : (
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onInstall(plugin, 'project')}
							disabled={pending}
							className="h-7 gap-1.5 px-2.5 text-xs"
						>
							<Download className="h-3.5 w-3.5" /> Install in project
						</Button>
						<Button
							size="sm"
							onClick={() => onInstall(plugin, 'global')}
							disabled={pending}
							className="h-7 gap-1.5 px-2.5 text-xs"
						>
							<Download className="h-3.5 w-3.5" /> Install globally
						</Button>
					</>
				)
			}
		>
			{plugin.description ? (
				<p className="text-xs leading-relaxed text-muted-foreground">
					{plugin.description}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-1.5">
				{plugin.official ? (
					<Badge variant="success">
						<ShieldCheck className="h-3 w-3" /> Official
					</Badge>
				) : null}
				<Badge>v{plugin.version}</Badge>
				<Badge>{formatPlatforms(plugin.platforms)}</Badge>
				{plugin.publisher ? <Badge>{plugin.publisher}</Badge> : null}
				{plugin.tags?.map((tag) => (
					<Badge key={tag}>{tag}</Badge>
				))}
			</div>
			{plugin.dependencies?.length ? (
				<DetailSection label="Installs with">
					<span className="font-mono text-[11px] text-foreground/90">
						{plugin.dependencies.join(', ')}
					</span>
				</DetailSection>
			) : null}
			<DetailSection label="Source">
				<SourceLink source={plugin.source} />
			</DetailSection>
		</EntityEditor>
	);
}
