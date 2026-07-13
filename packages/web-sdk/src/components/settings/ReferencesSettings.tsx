import { BookOpen, ChevronDown, FolderOpen, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
	useDeleteReference,
	useReferences,
	useSaveReference,
} from '../../hooks/useReferences';
import type {
	Reference,
	ReferenceScope,
} from '../../lib/api-client/references';
import { pickPlatformDirectory } from '../../lib/platform';
import { toast } from '../../stores/toastStore';
import { Button } from '../ui/Button';
import { StableSpinner } from '../ui/StableSpinner';
import { DirectoryBrowserModal } from './DirectoryBrowserModal';
import {
	EntityCheckbox,
	EntityEditor,
	EntityEmptyState,
	EntityField,
	EntityListGroup,
	EntityListPage,
	EntityRow,
	entityMonoInputClass,
	entitySelectClass,
	SegmentedControl,
} from './SettingsEntityPage';

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

type Draft = {
	name: string;
	description: string;
	type: 'git' | 'local';
	location: string;
	ref: string;
	enabled: boolean;
};

const EMPTY_DRAFT: Draft = {
	name: '',
	description: '',
	type: 'git',
	location: '',
	ref: '',
	enabled: true,
};

function toDraft(name: string, reference: Reference): Draft {
	return {
		name,
		description: reference.description,
		type: reference.source.type,
		location:
			reference.source.type === 'git'
				? reference.source.url
				: reference.source.path,
		ref: reference.source.type === 'git' ? (reference.source.ref ?? '') : '',
		enabled: reference.enabled !== false,
	};
}

export function ReferencesSettings() {
	const nameId = useId();
	const typeId = useId();
	const locationId = useId();
	const refId = useId();
	const descriptionId = useId();
	const enabledId = useId();
	const [scope, setScope] = useState<ReferenceScope>('local');
	const referencesQuery = useReferences(scope);
	const saveReference = useSaveReference();
	const deleteReference = useDeleteReference();
	const [selectedName, setSelectedName] = useState('');
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
	const [isBrowserOpen, setIsBrowserOpen] = useState(false);
	const references = referencesQuery.data?.references ?? {};
	const entries = useMemo(
		() => Object.entries(references).sort(([a], [b]) => a.localeCompare(b)),
		[references],
	);
	const normalizedName = draft.name.trim().toLowerCase();
	const isEditing = selectedName !== '' && selectedName === normalizedName;
	const isValid =
		NAME_PATTERN.test(normalizedName) &&
		draft.description.trim() !== '' &&
		draft.location.trim() !== '';

	function selectReference(name: string, reference: Reference) {
		setSelectedName(name);
		setDraft(toDraft(name, reference));
	}

	function createReference() {
		setSelectedName('');
		setDraft({ ...EMPTY_DRAFT, name: 'new-reference' });
	}

	function clearDraft() {
		setSelectedName('');
		setDraft(EMPTY_DRAFT);
	}

	async function handleBrowse() {
		const request = pickPlatformDirectory();
		if (!request) {
			setIsBrowserOpen(true);
			return;
		}
		try {
			const path = await request;
			if (path) {
				setDraft((current) => ({ ...current, location: path }));
			}
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: 'Failed to open directory picker',
			);
		}
	}

	async function handleSave() {
		if (!NAME_PATTERN.test(normalizedName)) {
			toast.error(
				'Names can only use lowercase letters, numbers, dots, dashes, and underscores.',
			);
			return;
		}
		if (!draft.description.trim() || !draft.location.trim()) {
			toast.error('Description and source are required.');
			return;
		}
		const source: Reference['source'] =
			draft.type === 'git'
				? {
						type: 'git',
						url: draft.location.trim(),
						...(draft.ref.trim() ? { ref: draft.ref.trim() } : {}),
					}
				: { type: 'local', path: draft.location.trim() };
		try {
			await saveReference.mutateAsync({
				name: normalizedName,
				scope,
				reference: {
					description: draft.description.trim(),
					enabled: draft.enabled,
					source,
				},
			});
			toast.success(`Saved ${normalizedName}`);
			clearDraft();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to save reference',
			);
		}
	}

	async function handleDelete() {
		if (!selectedName) return;
		try {
			await deleteReference.mutateAsync({ name: selectedName, scope });
			toast.success(`Deleted ${selectedName} from ${scope} config`);
			clearDraft();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to delete reference',
			);
		}
	}

	if (draft.name !== '') {
		return (
			<EntityEditor
				backLabel="All references"
				onBack={clearDraft}
				title={isEditing ? `Edit ${selectedName}` : 'New reference'}
				subtitle={`Saves to the ${scope === 'local' ? 'project' : 'global'} config`}
				footerStart={
					isEditing ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={handleDelete}
							disabled={deleteReference.isPending}
							className="h-7 gap-1 px-2 text-xs text-red-500 hover:text-red-400"
						>
							<Trash2 className="h-3.5 w-3.5" /> Delete
						</Button>
					) : null
				}
				footerEnd={
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={clearDraft}
							className="h-7 px-2.5 text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleSave}
							disabled={!isValid || saveReference.isPending}
							className="h-7 px-3 text-xs"
						>
							{saveReference.isPending ? 'Saving…' : 'Save reference'}
						</Button>
					</>
				}
			>
				<div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_160px]">
					<EntityField id={nameId} label="Name">
						<input
							id={nameId}
							value={draft.name}
							onChange={(event) =>
								setDraft({ ...draft, name: event.target.value })
							}
							className={entityMonoInputClass}
						/>
					</EntityField>
					<EntityField id={typeId} label="Source type">
						<div className="relative">
							<select
								id={typeId}
								value={draft.type}
								onChange={(event) =>
									setDraft({
										...draft,
										type: event.target.value as Draft['type'],
									})
								}
								className={entitySelectClass}
							>
								<option value="git">Git repository</option>
								<option value="local">Local directory</option>
							</select>
							<ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						</div>
					</EntityField>
				</div>
				<EntityField
					id={locationId}
					label={draft.type === 'git' ? 'Git URL' : 'Directory path'}
				>
					<div className="flex gap-2">
						<input
							id={locationId}
							value={draft.location}
							onChange={(event) =>
								setDraft({ ...draft, location: event.target.value })
							}
							placeholder={
								draft.type === 'git'
									? 'https://github.com/org/repository.git'
									: '~/dev/reference-project'
							}
							className={`${entityMonoInputClass} min-w-0 flex-1`}
						/>
						{draft.type === 'local' ? (
							<Button
								variant="secondary"
								size="sm"
								onClick={handleBrowse}
								className="h-8 shrink-0 gap-1.5 whitespace-nowrap px-2.5 text-xs"
							>
								<FolderOpen className="h-3.5 w-3.5" /> Browse
							</Button>
						) : null}
					</div>
				</EntityField>
				{draft.type === 'git' ? (
					<EntityField id={refId} label="Branch or tag (optional)">
						<input
							id={refId}
							value={draft.ref}
							onChange={(event) =>
								setDraft({ ...draft, ref: event.target.value })
							}
							placeholder="main"
							className={entityMonoInputClass}
						/>
					</EntityField>
				) : null}
				<EntityField id={descriptionId} label="When should Otto refer to this?">
					<textarea
						id={descriptionId}
						value={draft.description}
						onChange={(event) =>
							setDraft({ ...draft, description: event.target.value })
						}
						rows={3}
						placeholder="Use this when working on routing, middleware, or Hono conventions."
						className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
					/>
				</EntityField>
				<EntityCheckbox
					id={enabledId}
					checked={draft.enabled}
					onChange={(enabled) => setDraft({ ...draft, enabled })}
				>
					Make this reference available to Otto
				</EntityCheckbox>
				<DirectoryBrowserModal
					isOpen={isBrowserOpen}
					initialPath={
						draft.type === 'local' && draft.location.startsWith('/')
							? draft.location
							: undefined
					}
					onClose={() => setIsBrowserOpen(false)}
					onSelect={(path) => {
						setDraft((current) => ({ ...current, location: path }));
						setIsBrowserOpen(false);
					}}
				/>
			</EntityEditor>
		);
	}

	return (
		<EntityListPage
			toolbar={
				<>
					<SegmentedControl
						value={scope}
						options={[
							{ value: 'local', label: 'Project' },
							{ value: 'global', label: 'Global' },
						]}
						onChange={(value) => setScope(value)}
					/>
					<span className="text-xs text-muted-foreground">
						{entries.length} {entries.length === 1 ? 'reference' : 'references'}
					</span>
				</>
			}
			createLabel="New reference"
			onCreate={createReference}
			hint="The list shows the effective merged references. Saving and deleting affects the selected scope."
		>
			{referencesQuery.isLoading ? (
				<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
					<StableSpinner title="Loading references" /> Loading…
				</div>
			) : entries.length === 0 ? (
				<EntityEmptyState
					icon={<BookOpen className="h-4 w-4" />}
					title="No references yet"
					description="References give Otto relevant repositories and directories without adding their contents to every prompt."
					actionLabel="New reference"
					onAction={createReference}
				/>
			) : (
				<EntityListGroup>
					{entries.map(([name, reference]) => (
						<EntityRow
							key={name}
							onClick={() => selectReference(name, reference)}
							title={name}
							badge={reference.source.type === 'git' ? 'Git' : 'Local'}
							description={reference.description}
							meta={
								reference.source.type === 'git'
									? reference.source.url
									: reference.source.path
							}
						/>
					))}
				</EntityListGroup>
			)}
		</EntityListPage>
	);
}
