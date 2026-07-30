import { NeoOttoLogo } from './neopop/NeoOttoLogo';

/** Shared landing-page alias for the current multicolor Otto wordmark. */
export function OttoWordmark({
	height = 16,
	className = '',
}: {
	height?: number;
	className?: string;
}) {
	return <NeoOttoLogo height={height} className={className} />;
}
