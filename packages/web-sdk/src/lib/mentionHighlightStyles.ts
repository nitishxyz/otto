export type MentionHighlightKind = 'agent' | 'reference' | 'file' | 'skill';

export const mentionHighlightClasses: Record<MentionHighlightKind, string> = {
	agent: 'rounded bg-blue-500/15 box-decoration-clone px-1 -mx-1 py-0.5',
	reference: 'rounded bg-violet-500/15 box-decoration-clone px-1 -mx-1 py-0.5',
	file: 'rounded bg-foreground/10 box-decoration-clone px-1 -mx-1 py-0.5',
	skill: 'rounded bg-amber-500/15 box-decoration-clone px-1 -mx-1 py-0.5',
};
