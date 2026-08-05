import { memo, useState } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { DictationKeyword } from '../../lib/api-client';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface DictationVocabularySettingsProps {
	projectKeywords: string[];
	excludedProjectKeywords: string[];
	customKeywords: DictationKeyword[];
	onExcludedProjectKeywordsChange: (keywords: string[]) => void;
	onChange: (keywords: DictationKeyword[]) => void;
}

export const DictationVocabularySettings = memo(
	function DictationVocabularySettings({
		projectKeywords,
		excludedProjectKeywords,
		customKeywords,
		onExcludedProjectKeywordsChange,
		onChange,
	}: DictationVocabularySettingsProps) {
		const [keyword, setKeyword] = useState('');
		const [aliases, setAliases] = useState('');
		const excludedSet = new Set(
			excludedProjectKeywords.map((term) => term.toLocaleLowerCase()),
		);
		const activeProjectKeywords = projectKeywords.filter(
			(term) => !excludedSet.has(term.toLocaleLowerCase()),
		);
		const hiddenProjectKeywords = projectKeywords.filter((term) =>
			excludedSet.has(term.toLocaleLowerCase()),
		);

		const addKeyword = () => {
			const nextKeyword = keyword.trim().replace(/\s+/g, ' ');
			if (!nextKeyword) return;
			const nextAliases = Array.from(
				new Set(
					aliases
						.split(',')
						.map((alias) => alias.trim().replace(/\s+/g, ' '))
						.filter(Boolean),
				),
			).slice(0, 12);
			onChange([
				...customKeywords.filter(
					(entry) =>
						entry.keyword.toLocaleLowerCase() !==
						nextKeyword.toLocaleLowerCase(),
				),
				{ keyword: nextKeyword, aliases: nextAliases },
			]);
			setKeyword('');
			setAliases('');
		};

		return (
			<section className="pt-4">
				<h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
					Vocabulary
				</h3>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					Project terms are detected automatically. Your keywords bias speech
					recognition. Add likely misheard forms as aliases for guaranteed
					final-transcript corrections; keyword-only entries are only a model
					hint.
				</p>

				<div className="mt-3">
					<div className="text-xs font-medium text-foreground">
						Detected for this project
					</div>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{activeProjectKeywords.map((keyword) => (
							<span
								key={keyword}
								className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 py-1 pl-2 pr-1 text-[11px] text-muted-foreground"
							>
								{keyword}
								<button
									type="button"
									onClick={() =>
										onExcludedProjectKeywordsChange([
											...excludedProjectKeywords,
											keyword,
										])
									}
									className="rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground"
									aria-label={`Exclude ${keyword} from dictation vocabulary`}
									title="Exclude from dictation vocabulary"
								>
									<X className="h-3 w-3" />
								</button>
							</span>
						))}
						{activeProjectKeywords.length === 0 ? (
							<span className="text-[11px] text-muted-foreground/70">
								{projectKeywords.length === 0
									? 'No project terms detected.'
									: 'All detected terms are excluded.'}
							</span>
						) : null}
					</div>
					{hiddenProjectKeywords.length > 0 ? (
						<div className="mt-2 flex flex-wrap items-center gap-1.5">
							<span className="text-[11px] text-muted-foreground/70">
								Excluded:
							</span>
							{hiddenProjectKeywords.map((keyword) => (
								<button
									type="button"
									key={keyword}
									onClick={() =>
										onExcludedProjectKeywordsChange(
											excludedProjectKeywords.filter(
												(term) =>
													term.toLocaleLowerCase() !==
													keyword.toLocaleLowerCase(),
											),
										)
									}
									className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									title="Restore to dictation vocabulary"
								>
									<RotateCcw className="h-3 w-3" />
									{keyword}
								</button>
							))}
						</div>
					) : null}
				</div>

				<div className="mt-3 space-y-2">
					<div className="text-xs font-medium text-foreground">
						Your keywords
					</div>
					{customKeywords.length > 0 ? (
						<div className="divide-y divide-border/60 rounded-md border border-border/70">
							{customKeywords.map((entry) => (
								<div
									key={entry.keyword}
									className="flex items-center gap-2 px-2.5 py-2"
								>
									<div className="min-w-0 flex-1">
										<div className="truncate text-xs font-medium">
											{entry.keyword}
										</div>
										<div className="truncate text-[11px] text-muted-foreground">
											{entry.aliases?.length
												? `Sounds like: ${entry.aliases.join(', ')}`
												: 'Recognition bias only'}
										</div>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0"
										onClick={() =>
											onChange(
												customKeywords.filter(
													(item) => item.keyword !== entry.keyword,
												),
											)
										}
										aria-label={`Remove ${entry.keyword}`}
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
							))}
						</div>
					) : null}

					<form
						className="grid gap-2 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto]"
						onSubmit={(event) => {
							event.preventDefault();
							addKeyword();
						}}
					>
						<Input
							value={keyword}
							onChange={(event) => setKeyword(event.target.value)}
							placeholder="Keyword (e.g. AcmeDB)"
							maxLength={80}
							aria-label="Dictation keyword"
						/>
						<Input
							value={aliases}
							onChange={(event) => setAliases(event.target.value)}
							placeholder="Sounds like, comma separated"
							aria-label="Spoken aliases"
						/>
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							disabled={!keyword.trim()}
							className="gap-1.5"
						>
							<Plus className="h-3.5 w-3.5" />
							Add
						</Button>
					</form>
				</div>
			</section>
		);
	},
);
