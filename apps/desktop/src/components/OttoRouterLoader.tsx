import { OttoLogo } from './Icons';

export function OttoRouterLoader({ label }: { label?: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-5">
			<div className="ottorouter-loader-ring">
				<OttoLogo size={32} />
			</div>
			{label && (
				<span className="text-xs text-muted-foreground tracking-wide">
					{label}
				</span>
			)}
		</div>
	);
}
