import { Code2, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { StableSpinner } from '../ui/StableSpinner';

function decodeJsonFragment(value: string): string {
	let result = '';
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char !== '\\') {
			result += char;
			continue;
		}
		const next = value[index + 1];
		if (!next) break;
		index += 1;
		switch (next) {
			case 'n':
				result += '\n';
				break;
			case 'r':
				result += '\r';
				break;
			case 't':
				result += '\t';
				break;
			case 'b':
				result += '\b';
				break;
			case 'f':
				result += '\f';
				break;
			case 'u': {
				const code = value.slice(index + 1, index + 5);
				if (/^[a-f0-9]{4}$/i.test(code)) {
					result += String.fromCharCode(Number.parseInt(code, 16));
					index += 4;
				}
				break;
			}
			default:
				result += next;
		}
	}
	return result;
}

export function extractStreamingArtifactField(
	input: string,
	field: 'artifactId' | 'title' | 'description' | 'source',
): string {
	const marker = new RegExp(`"${field}"\\s*:\\s*"`).exec(input);
	if (!marker) return '';
	const start = marker.index + marker[0].length;
	let raw = '';
	for (let index = start; index < input.length; index += 1) {
		const char = input[index];
		if (char === '"') return decodeJsonFragment(raw);
		if (char === '\\' && index + 1 < input.length) {
			raw += char + input[index + 1];
			index += 1;
			continue;
		}
		raw += char;
	}
	return decodeJsonFragment(raw);
}

interface ArtifactStreamingPreviewProps {
	streamedInput: string;
	args?: Record<string, unknown>;
}

export const ArtifactStreamingPreview = memo(function ArtifactStreamingPreview({
	streamedInput,
	args,
}: ArtifactStreamingPreviewProps) {
	const title =
		(typeof args?.title === 'string' ? args.title : null) ??
		extractStreamingArtifactField(streamedInput, 'title') ??
		'Artifact';
	const description =
		(typeof args?.description === 'string' ? args.description : null) ??
		extractStreamingArtifactField(streamedInput, 'description');
	const source =
		(typeof args?.source === 'string' ? args.source : null) ??
		extractStreamingArtifactField(streamedInput, 'source');
	const sourceLines = source ? source.split('\n').length : 0;

	return (
		<section className="my-3 overflow-hidden rounded-2xl border border-violet-500/20 bg-background shadow-sm">
			<header className="flex min-h-14 items-center gap-3 border-b border-border bg-violet-500/[0.035] px-4 py-2.5">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
					<Sparkles className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium text-foreground">
						{title || 'Creating Artifact'}
					</div>
					<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<Code2 className="size-3" />
						<span>
							{sourceLines > 0
								? `Streaming React source · ${sourceLines} lines`
								: 'Preparing Otto runtime'}
						</span>
					</div>
				</div>
				<StableSpinner className="size-4 text-violet-500" />
			</header>
			<div className="p-4">
				{description ? (
					<p className="mb-4 text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}
				<div className="grid grid-cols-3 gap-2.5">
					{[0, 1, 2].map((index) => (
						<div
							key={index}
							className="h-20 animate-pulse rounded-xl border border-border bg-muted/30"
						/>
					))}
				</div>
				<div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
					<div className="h-full w-2/3 animate-pulse rounded-full bg-violet-500/45" />
				</div>
			</div>
		</section>
	);
});
