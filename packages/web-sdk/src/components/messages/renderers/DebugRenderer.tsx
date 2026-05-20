import type { RendererProps } from './types';

export function DebugRenderer({
	contentJson,
	toolDurationMs,
}: RendererProps & { toolName: string }) {
	return (
		<div className="text-[12px]">
			<div className="text-muted-foreground">
				<div>Tool: {contentJson.name}</div>
				<div>Duration: {toolDurationMs}ms</div>
				<pre className="mt-2 text-[10px] bg-card border border-border p-2 rounded overflow-x-auto">
					{JSON.stringify(contentJson, null, 2)}
				</pre>
			</div>
		</div>
	);
}
