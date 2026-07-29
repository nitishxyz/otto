export function OttoRouterLoader({ label }: { label?: string }) {
	return (
		<output
			aria-busy="true"
			aria-label={label ?? 'Loading'}
			className="flex flex-col items-center justify-center gap-5"
		>
			<div className="ottorouter-loader-ring">
				<img
					src="/otto-wordmark-1x1.png"
					alt=""
					className="otto-wordmark-loader"
					aria-hidden="true"
				/>
			</div>
			{label && (
				<span className="text-xs text-muted-foreground tracking-wide">
					{label}
				</span>
			)}
		</output>
	);
}
