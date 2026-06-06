import { memo, useState, type ComponentPropsWithoutRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
	User,
	X,
	FileText,
	FileIcon,
	Clock,
	Trash2,
	RotateCcw,
	FlaskConical,
	Code2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../../types/api';
import { useMessageQueuePosition } from '../../hooks/useQueueState';
import { useQueueStore } from '../../stores/queueStore';
import { apiClient } from '../../lib/api-client';
import { parseResearchContext } from '../../lib/parseResearchContext';
import { parseFileSelections } from '../../lib/fileSelectionContext';
import { linkifyExplicitSkillMentions } from '../../lib/skillMentions';
import { useSkills } from '../../hooks/useSkills';
import { useSkillsStore } from '../../stores/skillsStore';

interface UserMessageGroupProps {
	sessionId?: string;
	message: Message;
	isFirst: boolean;
	nextAssistantMessageId?: string;
}

interface ImageData {
	data?: string;
	mediaType: string;
	name?: string;
	attachmentId?: string;
}

interface FileData {
	type: 'image' | 'pdf' | 'text' | 'binary';
	name: string;
	data?: string;
	mediaType: string;
	textContent?: string;
	attachmentId?: string;
}

export const UserMessageGroup = memo(
	function UserMessageGroup({
		sessionId,
		message,
		nextAssistantMessageId,
	}: UserMessageGroupProps) {
		const [expandedImage, setExpandedImage] = useState<string | null>(null);
		const parts = message.parts || [];
		const queryClient = useQueryClient();
		const { data: skillsConfig } = useSkills();
		const expandSkillsSidebar = useSkillsStore((state) => state.expandSidebar);
		const selectSkill = useSkillsStore((state) => state.selectSkill);

		const { isQueued, position } = useMessageQueuePosition(
			sessionId,
			nextAssistantMessageId ?? '',
		);
		const setPendingRestoreText = useQueueStore(
			(state) => state.setPendingRestoreText,
		);

		const textParts = parts.filter((p) => p.type === 'text');
		const imageParts = parts.filter((p) => p.type === 'image');
		const fileParts = parts.filter((p) => p.type === 'file');

		const firstTextPart = textParts[0];
		let rawContent = '';

		if (firstTextPart) {
			const data = firstTextPart.contentJson || firstTextPart.content;
			if (data && typeof data === 'object' && 'text' in data) {
				rawContent = String(data.text);
			} else if (typeof data === 'string') {
				rawContent = data;
			} else if (data) {
				rawContent = JSON.stringify(data, null, 2);
			}
		}

		const { researchContexts: parsedResearchContexts, cleanContent: content } =
			parseResearchContext(rawContent);
		const {
			fileSelections: parsedFileSelections,
			cleanContent: contentAfterFileSelections,
		} = parseFileSelections(content);
		const renderedContent = linkifyExplicitSkillMentions(
			contentAfterFileSelections,
			skillsConfig?.items ?? [],
		);

		const images: Array<{ id: string; src: string }> = [];
		for (const part of imageParts) {
			try {
				const data = part.contentJson || JSON.parse(part.content || '{}');
				if (data && typeof data === 'object' && 'data' in data) {
					const imgData = data as ImageData;
					if (imgData.data) {
						const src = `data:${imgData.mediaType};base64,${imgData.data}`;
						images.push({ id: part.id, src });
					}
				}
			} catch {}
		}

		const files: Array<{ id: string; type: string; name: string }> = [];
		for (const part of fileParts) {
			try {
				const data = part.contentJson || JSON.parse(part.content || '{}');
				if (data && typeof data === 'object' && 'type' in data) {
					const fileData = data as FileData;
					if (fileData.type === 'image' && fileData.data) {
						const src = `data:${fileData.mediaType};base64,${fileData.data}`;
						images.push({ id: part.id, src });
					} else {
						files.push({
							id: part.id,
							type: fileData.type,
							name: fileData.name,
						});
					}
				}
			} catch {}
		}

		const formatTime = (ts?: number) => {
			if (!ts) return '';
			const date = new Date(ts);
			return date.toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
			});
		};

		const hasContent = contentAfterFileSelections.trim().length > 0;
		const hasImages = images.length > 0;
		const hasFiles = files.length > 0;
		const hasResearchContexts = parsedResearchContexts.length > 0;
		const hasFileSelections = parsedFileSelections.length > 0;

		if (
			!hasContent &&
			!hasImages &&
			!hasFiles &&
			!hasResearchContexts &&
			!hasFileSelections
		)
			return null;

		if (isQueued) return null;

		const handleCancel = async () => {
			if (!sessionId || !nextAssistantMessageId) return;
			setPendingRestoreText(content);
			try {
				await apiClient.removeFromQueue(sessionId, nextAssistantMessageId);
				// Invalidate messages to refresh UI
				queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
			} catch (err) {
				console.error('Failed to cancel queued message:', err);
			}
		};

		const handleSkillClick = (skillName: string) => {
			expandSkillsSidebar();
			selectSkill(skillName);
		};

		const handleDelete = async () => {
			if (!sessionId || !nextAssistantMessageId) return;
			try {
				await apiClient.removeFromQueue(sessionId, nextAssistantMessageId);
				// Invalidate messages to refresh UI
				queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
			} catch (err) {
				console.error('Failed to delete queued message:', err);
			}
		};

		return (
			<>
				<div className="relative pb-8 pt-6">
					<div className="flex flex-col items-end min-w-0 w-full">
						<div className="inline-flex items-center bg-emerald-500/10 border border-emerald-500/30 dark:bg-emerald-500/5 dark:border-emerald-500/20 rounded-full pl-3 md:pl-4 flex-shrink min-w-0 mb-2">
							<div className="flex items-center gap-x-1.5 md:gap-x-2 text-xs md:text-sm text-muted-foreground pr-2 md:pr-3 min-w-0">
								<span className="font-medium text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
									You
								</span>
								{message.createdAt && (
									<>
										<span className="text-muted-foreground/50">·</span>
										<span className="text-muted-foreground whitespace-nowrap">
											{formatTime(message.createdAt)}
										</span>
									</>
								)}
								{isQueued && (
									<>
										<span className="text-muted-foreground/50">·</span>
										<span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 whitespace-nowrap">
											<Clock className="h-3 w-3" />
											Queued
											{position !== null && position > 0
												? ` #${position + 1}`
												: ''}
										</span>
									</>
								)}
							</div>
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/20 dark:bg-emerald-500/10">
								<User className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
							</div>
						</div>
						<div className="flex flex-col items-end min-w-0 max-w-full md:max-w-2xl">
							<div className="inline-block max-w-full text-[16.5px] text-foreground leading-relaxed bg-card/80 border border-border rounded-xl px-4 py-3 [word-break:break-word] overflow-hidden">
								{hasImages && (
									<div className="flex flex-wrap gap-2 mb-2">
										{images.map((img) => (
											<button
												key={img.id}
												type="button"
												onClick={() => setExpandedImage(img.src)}
												className="w-16 h-16 rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary/50 transition-all"
											>
												<img
													src={img.src}
													alt="Attachment"
													className="w-full h-full object-cover"
												/>
											</button>
										))}
									</div>
								)}
								{hasFiles && (
									<div className="flex flex-wrap gap-2 mb-2">
										{files.map((file) => (
											<div
												key={file.id}
												className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border"
											>
												{file.type === 'pdf' ? (
													<FileIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
												) : (
													<FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
												)}
												<span className="text-xs truncate max-w-[150px]">
													{file.name}
												</span>
											</div>
										))}
									</div>
								)}
								{hasResearchContexts && (
									<div className="flex flex-wrap gap-2 mb-2">
										{parsedResearchContexts.map((ctx) => (
											<div
												key={ctx.id}
												className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500/10 border border-teal-500/30"
											>
												<FlaskConical className="w-4 h-4 text-teal-500 flex-shrink-0" />
												<span className="text-xs text-teal-600 dark:text-teal-400">
													{ctx.label}
												</span>
											</div>
										))}
									</div>
								)}
								{hasFileSelections && (
									<div className="flex flex-wrap gap-2 mb-2">
										{parsedFileSelections.map((sel) => (
											<div
												key={sel.id}
												className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 max-w-[260px]"
												title={sel.text}
											>
												<Code2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
												<span className="text-xs truncate font-mono text-blue-600 dark:text-blue-400">
													{sel.label}
												</span>
											</div>
										))}
									</div>
								)}
								{hasContent && (
									<div className="prose prose-invert prose-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:text-[16.5px] [&_li]:text-[16.5px] [&_*]:[word-break:break-word] [&_*]:overflow-wrap-anywhere whitespace-pre-wrap">
										<ReactMarkdown
											remarkPlugins={[remarkGfm]}
											components={{
												a: ({
													href,
													children,
													...props
												}: ComponentPropsWithoutRef<'a'>) => {
													const skillHref = href?.startsWith('#otto-skill:')
														? href.slice('#otto-skill:'.length)
														: href?.startsWith('otto-skill:')
															? href.slice('otto-skill:'.length)
															: null;
													if (skillHref) {
														const skillName = decodeURIComponent(skillHref);
														return (
															<button
																type="button"
																onClick={() => handleSkillClick(skillName)}
																className="inline-flex align-baseline items-center rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-violet-600 dark:text-violet-300 hover:bg-violet-500/15 transition-colors"
																title={`Open ${skillName} SKILL.md`}
															>
																{children}
															</button>
														);
													}
													return (
														<a
															href={href}
															target="_blank"
															rel="noopener noreferrer"
															className="text-primary underline decoration-primary/35 underline-offset-2 transition-colors hover:text-primary/90 hover:decoration-primary"
															onClick={(e) => {
																if (window.self !== window.top && href) {
																	e.preventDefault();
																	window.parent.postMessage(
																		{
																			type: 'otto-open-url',
																			url: href,
																		},
																		'*',
																	);
																}
															}}
															{...props}
														>
															{children}
														</a>
													);
												},
											}}
										>
											{renderedContent.replace(/\n/g, '  \n')}
										</ReactMarkdown>
									</div>
								)}
							</div>
							{isQueued && (
								<div className="flex items-center gap-2 mt-2">
									<button
										type="button"
										onClick={handleCancel}
										className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
										title="Cancel and restore to input"
									>
										<RotateCcw className="h-3 w-3" />
										Cancel
									</button>
									<button
										type="button"
										onClick={handleDelete}
										className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
										title="Delete from queue"
									>
										<Trash2 className="h-3 w-3" />
										Delete
									</button>
								</div>
							)}
						</div>
					</div>
				</div>

				{expandedImage && (
					<div
						role="dialog"
						aria-modal="true"
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
						onClick={() => setExpandedImage(null)}
						onKeyDown={(e) => e.key === 'Escape' && setExpandedImage(null)}
						tabIndex={-1}
					>
						<button
							type="button"
							onClick={() => setExpandedImage(null)}
							className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
						>
							<X className="w-6 h-6 text-white" />
						</button>
						<img
							src={expandedImage}
							alt="Expanded attachment"
							className="max-w-full max-h-full object-contain rounded-lg"
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
						/>
					</div>
				)}
			</>
		);
	},
	(prevProps, nextProps) => {
		const prevFirstPart = prevProps.message.parts?.[0];
		const nextFirstPart = nextProps.message.parts?.[0];

		return (
			prevProps.message.id === nextProps.message.id &&
			prevFirstPart?.content === nextFirstPart?.content &&
			prevFirstPart?.contentJson === nextFirstPart?.contentJson &&
			prevProps.message.createdAt === nextProps.message.createdAt &&
			prevProps.message.parts?.length === nextProps.message.parts?.length &&
			prevProps.sessionId === nextProps.sessionId &&
			prevProps.nextAssistantMessageId === nextProps.nextAssistantMessageId
		);
	},
);
