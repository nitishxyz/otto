import { useEffect } from 'react';
import { Terminal } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { loadNerdFont, NERD_FONT_FAMILY } from '../../../lib/nerd-font';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
	ToolContentBox,
} from './shared';

export function BashRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	useEffect(() => {
		void loadNerdFont();
	}, []);

	const result = contentJson.result || {};
	const args = contentJson.args || {};

	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: null;
	const errorStack =
		hasToolError && 'stack' in result && typeof result.stack === 'string'
			? result.stack
			: undefined;

	const stdout = String(result.stdout || '');
	const stderr = String(result.stderr || '');
	const exitCode = Number(result.exitCode ?? 0);
	const cmd = String(args.cmd || '');
	const cwd = args.cwd ? String(args.cwd) : undefined;
	const timeStr = formatDuration(toolDurationMs);
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	const hasOutput = stdout.length > 0 || stderr.length > 0;
	const isError = hasToolError || exitCode !== 0;
	const hasStderr = stderr.length > 0;
	const combinedOutput = stdout + (stdout && stderr ? '\n' : '') + stderr;
	const outputStyle = {
		margin: 0,
		padding: '0.75rem',
		fontFamily: NERD_FONT_FAMILY,
		fontSize: '0.75rem',
		lineHeight: '1.5',
		background: 'transparent',
		maxWidth: '100%',
	};
	const outputCodeProps = {
		style: {
			fontFamily: NERD_FONT_FAMILY,
		},
	};

	return (
		<div className="text-xs">
			<ToolHeader
				toolName="shell"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={isError}
				colorVariant="default"
				canExpand={true}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span
							className="text-foreground/70 min-w-0 truncate font-mono text-[11px]"
							title={cmd}
						>
							{cmd}
						</span>
					</>
				)}
				{!hasToolError && !compact && (
					<>
						<ToolHeaderSeparator />
						{exitCode === 0 ? (
							<ToolHeaderSuccess>exit {exitCode}</ToolHeaderSuccess>
						) : (
							<ToolHeaderError>exit {exitCode}</ToolHeaderError>
						)}
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
				{hasToolError && !compact && (
					<ToolHeaderMeta>· {timeStr}</ToolHeaderMeta>
				)}
			</ToolHeader>

			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasToolError && (
				<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
					<ToolContentBox
						title="command"
						icon={<Terminal className="h-3 w-3" />}
						subtitle={cwd && cwd !== '.' ? `in ${cwd}` : undefined}
						copyText={cmd}
						maxHeight=""
					>
						<div className="px-3 py-2 font-mono text-xs bg-muted/10 break-all">
							{cmd}
						</div>
					</ToolContentBox>

					{hasOutput &&
						(exitCode === 0 ? (
							<ToolContentBox
								title="output"
								copyText={combinedOutput}
								maxHeight="max-h-[30rem]"
							>
								<SyntaxHighlighter
									language="bash"
									style={syntaxTheme}
									customStyle={outputStyle}
									codeTagProps={outputCodeProps}
									wrapLines
									wrapLongLines
								>
									{combinedOutput}
								</SyntaxHighlighter>
							</ToolContentBox>
						) : (
							<>
								{stdout && (
									<ToolContentBox
										title="stdout"
										copyText={stdout}
										maxHeight="max-h-60"
									>
										<SyntaxHighlighter
											language="bash"
											style={syntaxTheme}
											customStyle={outputStyle}
											codeTagProps={outputCodeProps}
											wrapLines
											wrapLongLines
										>
											{stdout}
										</SyntaxHighlighter>
									</ToolContentBox>
								)}
								{hasStderr && (
									<ToolContentBox
										title="stderr"
										copyText={stderr}
										variant="error"
										maxHeight="max-h-60"
									>
										<SyntaxHighlighter
											language="bash"
											style={syntaxTheme}
											customStyle={outputStyle}
											codeTagProps={outputCodeProps}
											wrapLines
											wrapLongLines
										>
											{stderr}
										</SyntaxHighlighter>
									</ToolContentBox>
								)}
							</>
						))}
				</div>
			)}
		</div>
	);
}
