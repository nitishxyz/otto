import { useId, useMemo, useState } from 'react';
import { ChefHat, ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { StableSpinner } from '../ui/StableSpinner';
import {
	EntityCheckbox,
	EntityEditor,
	EntityEmptyState,
	EntityField,
	EntityListGroup,
	EntityListPage,
	EntityRow,
	entityInputClass,
	entityMonoInputClass,
	entitySelectClass,
	SegmentedControl,
} from './SettingsEntityPage';
import {
	useDeleteRecipe,
	useRecipes,
	useSaveRecipe,
} from '../../hooks/useRecipes';
import { useMentionAgents } from '../../hooks/useAgents';
import { toast } from '../../stores/toastStore';
import type { RecipeScope } from '../../lib/api-client/recipes';
import { isReservedRecipeCommandName } from '../../lib/reserved-recipe-names';
import {
	parseRecipeContent,
	serializeRecipeContent,
} from '../../lib/recipe-content';

const RECIPE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const RECIPE_SCOPE_PATHS: Record<RecipeScope, string> = {
	project: '.otto/recipes',
	global: '~/.config/otto/recipes',
};

function recipeKey(scope: RecipeScope, name: string) {
	return `${scope}:${name}`;
}
const DEFAULT_RECIPE_AGENT = 'build';

export function RecipesSettings() {
	const recipeNameId = useId();
	const recipeDescriptionId = useId();
	const recipeAgentId = useId();
	const recipeIncludeInHistoryId = useId();
	const recipeInstructionsId = useId();
	const [editorScope, setEditorScope] = useState<RecipeScope>('project');
	const recipesQuery = useRecipes({ scope: editorScope });
	const allRecipesQuery = useRecipes({ scope: 'all' });
	const agentsQuery = useMentionAgents();
	const saveRecipe = useSaveRecipe();
	const deleteRecipe = useDeleteRecipe();
	const recipes = recipesQuery.data?.recipes ?? [];
	const allRecipes = allRecipesQuery.data?.recipes ?? [];
	const agents = agentsQuery.data?.agents ?? [];
	const [selectedKey, setSelectedKey] = useState('');
	const [draftAgent, setDraftAgent] = useState(DEFAULT_RECIPE_AGENT);
	const [draftIncludeInHistory, setDraftIncludeInHistory] = useState(true);
	const [draftName, setDraftName] = useState('');
	const [draftDescription, setDraftDescription] = useState('');
	const [draftInstructions, setDraftInstructions] = useState('');
	const [unknownFrontmatter, setUnknownFrontmatter] = useState<string[]>([]);
	const [parseError, setParseError] = useState<string>();
	const [savedDraft, setSavedDraft] = useState<{
		scope: RecipeScope;
		name: string;
		agent: string;
		includeInHistory: boolean;
		description: string;
		instructions: string;
	} | null>(null);

	const selectedRecipe = useMemo(
		() =>
			recipes.find(
				(recipe) => recipeKey(recipe.scope, recipe.name) === selectedKey,
			),
		[recipes, selectedKey],
	);
	const effectiveName = draftName.trim().toLowerCase();
	const isNameValid = RECIPE_NAME_PATTERN.test(effectiveName);
	const isReservedName =
		effectiveName !== '' && isReservedRecipeCommandName(effectiveName);
	const crossScopeDuplicate = useMemo(
		() =>
			allRecipes.find(
				(recipe) =>
					recipe.name === effectiveName && recipe.scope !== editorScope,
			),
		[allRecipes, effectiveName, editorScope],
	);
	const saveBlockedReason = !isNameValid
		? null
		: isReservedName
			? 'This name is reserved by a built-in slash command.'
			: crossScopeDuplicate
				? `A ${crossScopeDuplicate.scope} recipe with this name already exists.`
				: null;
	const isSaving = saveRecipe.isPending;
	const isDeleting = deleteRecipe.isPending;
	const hasDraft =
		draftName !== '' || draftDescription !== '' || draftInstructions !== '';
	const isEditingExisting =
		selectedRecipe &&
		selectedRecipe.name === effectiveName &&
		selectedRecipe.scope === editorScope;
	const hasChanges =
		hasDraft &&
		(!savedDraft ||
			editorScope !== savedDraft.scope ||
			effectiveName !== savedDraft.name ||
			draftAgent !== savedDraft.agent ||
			draftIncludeInHistory !== savedDraft.includeInHistory ||
			draftDescription !== savedDraft.description ||
			draftInstructions !== savedDraft.instructions);

	function selectRecipe(scope: RecipeScope, name: string) {
		const recipe = recipes.find(
			(item) => item.scope === scope && item.name === name,
		);
		const parsed = parseRecipeContent(recipe?.content ?? '', {
			description: recipe?.description,
			agent: recipe?.agent || DEFAULT_RECIPE_AGENT,
			includeInHistory: recipe?.includeInHistory,
		});
		setSelectedKey(recipeKey(scope, name));
		setEditorScope(scope);
		setDraftName(name);
		setDraftAgent(parsed.agent);
		setDraftIncludeInHistory(parsed.includeInHistory);
		setDraftDescription(parsed.description);
		setDraftInstructions(parsed.instructions);
		setUnknownFrontmatter(parsed.unknownFrontmatter);
		setParseError(parsed.error);
		setSavedDraft(
			recipe
				? {
						scope: recipe.scope,
						name: recipe.name,
						agent: parsed.agent,
						includeInHistory: parsed.includeInHistory,
						description: parsed.description,
						instructions: parsed.instructions,
					}
				: null,
		);
	}

	function createRecipe() {
		const name = 'new-recipe';
		setSelectedKey('');
		setDraftName(name);
		setDraftAgent(DEFAULT_RECIPE_AGENT);
		setDraftIncludeInHistory(true);
		setDraftDescription('');
		setDraftInstructions('');
		setUnknownFrontmatter([]);
		setParseError(undefined);
		setSavedDraft(null);
	}

	function clearDraft() {
		setSelectedKey('');
		setDraftName('');
		setDraftAgent(DEFAULT_RECIPE_AGENT);
		setDraftIncludeInHistory(true);
		setDraftDescription('');
		setDraftInstructions('');
		setUnknownFrontmatter([]);
		setParseError(undefined);
		setSavedDraft(null);
	}

	async function handleSave() {
		if (!isNameValid) {
			toast.error('Names can only use lowercase letters, numbers, and dashes.');
			return;
		}
		if (!draftInstructions.trim()) {
			toast.error('Recipe instructions are required.');
			return;
		}
		if (saveBlockedReason || parseError) {
			toast.error(
				saveBlockedReason ?? parseError ?? 'Cannot save this recipe.',
			);
			return;
		}

		try {
			const content = serializeRecipeContent({
				description: draftDescription,
				agent: draftAgent || DEFAULT_RECIPE_AGENT,
				includeInHistory: draftIncludeInHistory,
				instructions: draftInstructions,
				unknownFrontmatter,
			});
			await saveRecipe.mutateAsync({
				name: effectiveName,
				content,
				scope: editorScope,
			});
			toast.success(`Saved /${effectiveName}`);
			clearDraft();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to save recipe',
			);
		}
	}

	async function handleDelete() {
		if (!selectedRecipe) return;
		try {
			await deleteRecipe.mutateAsync({
				name: selectedRecipe.name,
				scope: selectedRecipe.scope,
			});
			toast.success(`Deleted /${selectedRecipe.name}`);
			clearDraft();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to delete recipe',
			);
		}
	}

	if (hasDraft) {
		return (
			<EntityEditor
				backLabel="All recipes"
				onBack={clearDraft}
				title={isEditingExisting ? `Edit /${effectiveName}` : 'New recipe'}
				subtitle={`Saves to ${RECIPE_SCOPE_PATHS[editorScope]}`}
				footerStart={
					isEditingExisting ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={handleDelete}
							disabled={isDeleting}
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
							disabled={
								!isNameValid ||
								Boolean(saveBlockedReason) ||
								Boolean(parseError) ||
								!draftInstructions.trim() ||
								!hasChanges ||
								isSaving
							}
							className="h-7 px-3 text-xs"
						>
							{isSaving ? 'Saving…' : 'Save recipe'}
						</Button>
					</>
				}
			>
				<div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_160px]">
					<EntityField
						id={recipeNameId}
						label="Name"
						hint="Runs as a slash command in chat."
						error={
							!isNameValid && effectiveName !== ''
								? 'Lowercase letters, numbers, and dashes only.'
								: (saveBlockedReason ?? undefined)
						}
					>
						<input
							id={recipeNameId}
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							placeholder="publish-ready"
							className={entityMonoInputClass}
						/>
					</EntityField>
					<EntityField id={recipeAgentId} label="Agent">
						<div className="relative">
							<select
								id={recipeAgentId}
								value={draftAgent}
								onChange={(event) => setDraftAgent(event.target.value)}
								className={entitySelectClass}
							>
								{agents.some(
									(agent) => agent.name === DEFAULT_RECIPE_AGENT,
								) ? null : (
									<option value={DEFAULT_RECIPE_AGENT}>build</option>
								)}
								{agents.map((agent) => (
									<option key={agent.name} value={agent.name}>
										{agent.name}
									</option>
								))}
							</select>
							<ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						</div>
					</EntityField>
				</div>
				<EntityField
					id={recipeDescriptionId}
					label="Short description"
					hint="Shown in the recipe library and command picker."
				>
					<input
						id={recipeDescriptionId}
						value={draftDescription}
						onChange={(event) => setDraftDescription(event.target.value)}
						placeholder="Review a document and prepare it for publication"
						className={entityInputClass}
					/>
				</EntityField>
				{parseError ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
						{parseError}
					</div>
				) : null}
				<div className="flex min-h-0 flex-1 flex-col">
					<label
						className="mb-1 text-xs font-medium text-muted-foreground"
						htmlFor={recipeInstructionsId}
					>
						What should Otto do?
					</label>
					<textarea
						id={recipeInstructionsId}
						value={draftInstructions}
						onChange={(event) => setDraftInstructions(event.target.value)}
						placeholder="Explain the task in plain language. Include the files to review, the result you want, and any checks Otto should run."
						disabled={Boolean(parseError)}
						className="min-h-[180px] w-full flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
					/>
				</div>
				<EntityCheckbox
					id={recipeIncludeInHistoryId}
					checked={draftIncludeInHistory}
					onChange={setDraftIncludeInHistory}
				>
					Include this recipe run in session history and let it use prior
					context.
				</EntityCheckbox>
			</EntityEditor>
		);
	}

	return (
		<EntityListPage
			toolbar={
				<>
					<SegmentedControl
						value={editorScope}
						options={[
							{ value: 'project', label: 'Project' },
							{ value: 'global', label: 'Global' },
						]}
						onChange={(scope) => {
							setEditorScope(scope);
							setSelectedKey('');
							setDraftName('');
							setDraftDescription('');
							setDraftInstructions('');
							setUnknownFrontmatter([]);
							setParseError(undefined);
							setSavedDraft(null);
						}}
					/>
					<span className="text-xs text-muted-foreground">
						{recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'} in{' '}
						<span className="font-mono text-[11px]">
							{RECIPE_SCOPE_PATHS[editorScope]}
						</span>
					</span>
				</>
			}
			createLabel="New recipe"
			onCreate={createRecipe}
		>
			{recipesQuery.isLoading ? (
				<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
					<StableSpinner title="Loading recipes" />
					Loading…
				</div>
			) : recipes.length === 0 ? (
				<EntityEmptyState
					icon={<ChefHat className="h-4 w-4" />}
					title="No recipes yet"
					description="Recipes are reusable slash commands. Create one here or ask Otto to make one in chat."
					actionLabel="New recipe"
					onAction={createRecipe}
				/>
			) : (
				<EntityListGroup>
					{recipes.map((recipe) => (
						<EntityRow
							key={recipeKey(recipe.scope, recipe.name)}
							onClick={() => selectRecipe(recipe.scope, recipe.name)}
							title={`/${recipe.name}`}
							warning={
								recipe.conflict
									? `Conflict: ${recipe.conflict.reason}`
									: undefined
							}
							description={recipe.description || undefined}
							meta={recipe.agent || DEFAULT_RECIPE_AGENT}
						/>
					))}
				</EntityListGroup>
			)}
		</EntityListPage>
	);
}
