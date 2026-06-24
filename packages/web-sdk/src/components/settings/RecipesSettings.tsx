import { useId, useMemo, useState } from 'react';
import { ChefHat, ChevronDown, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { StableSpinner } from '../ui/StableSpinner';
import {
	useDeleteRecipe,
	useRecipes,
	useSaveRecipe,
} from '../../hooks/useRecipes';
import { useMentionAgents } from '../../hooks/useAgents';
import { toast } from '../../stores/toastStore';

const RECIPE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_RECIPE_AGENT = 'build';

function defaultRecipeContent(name: string) {
	return [
		'---',
		`description: Describe what /${name || 'recipe-name'} does`,
		`agent: ${DEFAULT_RECIPE_AGENT}`,
		'includeInHistory: true',
		'---',
		'',
		'Write natural-language instructions for Otto here.',
		'',
		'Keep the task focused and mention any checks Otto should run.',
	].join('\n');
}

function setFrontmatterField(content: string, key: string, value: string) {
	const normalized = content.replace(/\r\n?/g, '\n');
	const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		return ['---', `${key}: ${value}`, '---', '', normalized.trim()].join('\n');
	}

	const frontmatter = match[1] ?? '';
	const body = match[2] ?? '';
	const lines = frontmatter.split('\n');
	const index = lines.findIndex((line) =>
		new RegExp(`^${key}\\s*:`, 'i').test(line.trim()),
	);
	if (index >= 0) {
		lines[index] = `${key}: ${value}`;
	} else {
		lines.push(`${key}: ${value}`);
	}
	return ['---', ...lines, '---', body].join('\n').trimEnd();
}

export function RecipesSettings() {
	const recipeNameId = useId();
	const recipeAgentId = useId();
	const recipeIncludeInHistoryId = useId();
	const recipeContentId = useId();
	const recipesQuery = useRecipes();
	const agentsQuery = useMentionAgents();
	const saveRecipe = useSaveRecipe();
	const deleteRecipe = useDeleteRecipe();
	const recipes = recipesQuery.data?.recipes ?? [];
	const agents = agentsQuery.data?.agents ?? [];
	const [selectedName, setSelectedName] = useState('');
	const [draftAgent, setDraftAgent] = useState(DEFAULT_RECIPE_AGENT);
	const [draftIncludeInHistory, setDraftIncludeInHistory] = useState(true);
	const [draftName, setDraftName] = useState('');
	const [draftContent, setDraftContent] = useState('');
	const [savedDraft, setSavedDraft] = useState<{
		name: string;
		agent: string;
		includeInHistory: boolean;
		content: string;
	} | null>(null);

	const selectedRecipe = useMemo(
		() => recipes.find((recipe) => recipe.name === selectedName),
		[recipes, selectedName],
	);
	const effectiveName = draftName.trim().toLowerCase();
	const isNameValid = RECIPE_NAME_PATTERN.test(effectiveName);
	const isSaving = saveRecipe.isPending;
	const isDeleting = deleteRecipe.isPending;
	const hasDraft = draftName !== '' || draftContent !== '';
	const isEditingExisting =
		selectedRecipe && selectedRecipe.name === effectiveName;
	const hasChanges =
		hasDraft &&
		(!savedDraft ||
			effectiveName !== savedDraft.name ||
			draftAgent !== savedDraft.agent ||
			draftIncludeInHistory !== savedDraft.includeInHistory ||
			draftContent !== savedDraft.content);

	function selectRecipe(name: string) {
		const recipe = recipes.find((item) => item.name === name);
		setSelectedName(name);
		setDraftName(name);
		setDraftAgent(recipe?.agent || DEFAULT_RECIPE_AGENT);
		setDraftIncludeInHistory(recipe?.includeInHistory ?? true);
		setDraftContent(recipe?.content ?? '');
		setSavedDraft(
			recipe
				? {
						name: recipe.name,
						agent: recipe.agent || DEFAULT_RECIPE_AGENT,
						includeInHistory: recipe.includeInHistory,
						content: recipe.content,
					}
				: null,
		);
	}

	function createRecipe() {
		const name = 'new-recipe';
		setSelectedName('');
		setDraftName(name);
		setDraftAgent(DEFAULT_RECIPE_AGENT);
		setDraftIncludeInHistory(true);
		setDraftContent(defaultRecipeContent(name));
		setSavedDraft(null);
	}

	function clearDraft() {
		setSelectedName('');
		setDraftName('');
		setDraftAgent(DEFAULT_RECIPE_AGENT);
		setDraftIncludeInHistory(true);
		setDraftContent('');
		setSavedDraft(null);
	}

	async function handleSave() {
		if (!isNameValid) {
			toast.error('Names can only use lowercase letters, numbers, and dashes.');
			return;
		}
		if (!draftContent.trim()) {
			toast.error('Recipe instructions are required.');
			return;
		}

		try {
			const content = setFrontmatterField(
				setFrontmatterField(
					draftContent,
					'agent',
					draftAgent || DEFAULT_RECIPE_AGENT,
				),
				'includeInHistory',
				String(draftIncludeInHistory),
			);
			await saveRecipe.mutateAsync({
				name: effectiveName,
				content,
			});
			setSelectedName(effectiveName);
			setDraftName(effectiveName);
			setDraftContent(content);
			setSavedDraft({
				name: effectiveName,
				agent: draftAgent || DEFAULT_RECIPE_AGENT,
				includeInHistory: draftIncludeInHistory,
				content,
			});
			toast.success(`Saved /${effectiveName}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to save recipe',
			);
		}
	}

	async function handleDelete() {
		if (!selectedRecipe) return;
		try {
			await deleteRecipe.mutateAsync(selectedRecipe.name);
			toast.success(`Deleted /${selectedRecipe.name}`);
			clearDraft();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to delete recipe',
			);
		}
	}

	return (
		<div className="flex h-full min-h-0 gap-4 overflow-hidden">
			{/* Recipe list */}
			<div className="flex w-48 shrink-0 flex-col">
				<div className="mb-2 flex items-center justify-between">
					<span className="text-xs font-medium text-muted-foreground">
						{recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
					</span>
					<button
						type="button"
						onClick={createRecipe}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Plus className="h-3 w-3" />
						New
					</button>
				</div>
				<div className="-mx-1 flex-1 overflow-y-auto px-1">
					{recipesQuery.isLoading ? (
						<div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
							<StableSpinner title="Loading recipes" />
							Loading…
						</div>
					) : recipes.length === 0 ? (
						<p className="py-4 text-xs leading-relaxed text-muted-foreground">
							No recipes yet. Create one or ask Otto to make one in chat.
						</p>
					) : (
						<div className="space-y-0.5">
							{recipes.map((recipe) => (
								<button
									key={recipe.name}
									type="button"
									onClick={() => selectRecipe(recipe.name)}
									className={`w-full rounded-md px-2.5 py-1.5 text-left transition-colors ${
										selectedName === recipe.name
											? 'bg-primary/10 text-foreground'
											: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
									}`}
								>
									<div className="font-mono text-xs font-medium">
										/{recipe.name}
									</div>
									{recipe.description ? (
										<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
											{recipe.description}
										</div>
									) : null}
									<div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
										{recipe.agent || DEFAULT_RECIPE_AGENT}
									</div>
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Editor or empty state */}
			{!hasDraft ? (
				<div className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/10 px-6 text-center">
					<ChefHat className="mb-3 h-8 w-8 text-muted-foreground/40" />
					<p className="text-sm font-medium text-foreground">
						No recipe selected
					</p>
					<p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
						Select a recipe from the list, or create a new one. Recipes run as
						slash commands in chat.
					</p>
					<Button
						size="sm"
						variant="secondary"
						onClick={createRecipe}
						className="mt-4 gap-1.5"
					>
						<Plus className="h-3.5 w-3.5" />
						Create Recipe
					</Button>
				</div>
			) : (
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
						<div>
							<label
								className="text-xs font-medium text-muted-foreground"
								htmlFor={recipeNameId}
							>
								Name
							</label>
							<input
								id={recipeNameId}
								value={draftName}
								onChange={(event) => setDraftName(event.target.value)}
								placeholder="publish-ready"
								className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
							/>
							{!isNameValid && effectiveName !== '' ? (
								<p className="mt-1 text-[11px] text-red-400">
									Lowercase letters, numbers, and dashes only.
								</p>
							) : null}
						</div>
						<div>
							<label
								className="text-xs font-medium text-muted-foreground"
								htmlFor={recipeAgentId}
							>
								Agent
							</label>
							<div className="relative mt-1">
								<select
									id={recipeAgentId}
									value={draftAgent}
									onChange={(event) => setDraftAgent(event.target.value)}
									className="w-full appearance-none rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary"
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
						</div>
					</div>
					<label
						className="mb-3 flex items-start gap-2 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-xs text-muted-foreground"
						htmlFor={recipeIncludeInHistoryId}
					>
						<input
							id={recipeIncludeInHistoryId}
							type="checkbox"
							checked={draftIncludeInHistory}
							onChange={(event) =>
								setDraftIncludeInHistory(event.target.checked)
							}
							className="mt-0.5 h-3.5 w-3.5 rounded border-border bg-background accent-primary"
						/>
						<span>
							Include this recipe run in session history and let it use prior
							context.
						</span>
					</label>

					{/* Instructions */}
					<div className="flex min-h-0 flex-1 flex-col">
						<label
							className="mb-1 text-xs font-medium text-muted-foreground"
							htmlFor={recipeContentId}
						>
							Instructions
						</label>
						<textarea
							id={recipeContentId}
							value={draftContent}
							onChange={(event) => setDraftContent(event.target.value)}
							placeholder={defaultRecipeContent(effectiveName)}
							className="min-h-0 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-primary"
						/>
					</div>

					{/* Actions */}
					<div className="mt-3 flex items-center justify-between">
						<div className="flex items-center gap-2">
							{isEditingExisting ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={handleDelete}
									disabled={isDeleting}
									className="gap-1.5 text-red-500 hover:text-red-400"
								>
									<Trash2 className="h-3.5 w-3.5" />
									Delete
								</Button>
							) : null}
							<button
								type="button"
								onClick={clearDraft}
								className="px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
							>
								Cancel
							</button>
						</div>
						<Button
							size="sm"
							onClick={handleSave}
							disabled={
								!isNameValid || !draftContent.trim() || !hasChanges || isSaving
							}
							className="gap-1.5"
						>
							<Save className="h-3.5 w-3.5" />
							Save
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
