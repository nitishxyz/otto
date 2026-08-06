import { InlinePatchDiff } from '../../diff/InlineDiff';

interface DiffViewProps {
	patch: string;
	/** Used when the payload carries hunks but no filename of its own. */
	filePath?: string;
	/** Set when the surrounding renderer already shows the filename. */
	hidePathHeader?: boolean;
}

/**
 * Inline patch surface used by the tool/message renderers. Delegates to the
 * shared Pierre diff surface so inline diffs match the full-pane viewer and the
 * active Otto theme.
 */
export function DiffView({ patch, filePath, hidePathHeader }: DiffViewProps) {
	return (
		<InlinePatchDiff
			patch={patch}
			fallbackPath={filePath}
			hidePathHeader={hidePathHeader}
		/>
	);
}
