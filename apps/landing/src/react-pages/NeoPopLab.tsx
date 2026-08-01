import { useState } from 'react';
import {
	buildNeoCodeMarkSvg,
	NeoBox,
	NeoButton,
	NeoCodeMark,
	type NeoCodeMarkGeometry,
	type NeoCodeMarkPalette,
} from '../components/neopop';

const PRESETS: Record<string, NeoCodeMarkGeometry> = {
	Balanced: {
		height: 160,
		arm: 62,
		thickness: 18,
		gap: 48,
		corner: 7,
		depth: 10,
	},
	Compact: {
		height: 160,
		arm: 48,
		thickness: 21,
		gap: 20,
		corner: 5,
		depth: 8,
	},
	Wide: { height: 160, arm: 78, thickness: 15, gap: 82, corner: 10, depth: 14 },
	Block: { height: 160, arm: 58, thickness: 27, gap: 32, corner: 2, depth: 12 },
};

const PALETTES: Record<string, NeoCodeMarkPalette> = {
	Pop: {
		left: '#4865cc',
		leftCast: '#283c8c',
		right: '#62ad8b',
		rightCast: '#346852',
	},
	Warm: {
		left: '#c9403a',
		leftCast: '#84241f',
		right: '#e9a21b',
		rightCast: '#9e6a0c',
	},
	Mono: {
		left: '#f3f4f6',
		leftCast: '#6b7280',
		right: '#f3f4f6',
		rightCast: '#6b7280',
	},
};

interface RangeFieldProps {
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
}

function RangeField({ label, value, min, max, onChange }: RangeFieldProps) {
	return (
		<label className="block">
			<span className="mb-2 flex items-center justify-between text-[12px] text-otto-muted">
				<span>{label}</span>
				<output className="text-otto-text">{value}px</output>
			</span>
			<input
				type="range"
				min={min}
				max={max}
				value={value}
				onChange={(event) => onChange(Number(event.currentTarget.value))}
				className="h-2 w-full cursor-pointer appearance-none rounded-none bg-otto-border accent-np-blue"
			/>
		</label>
	);
}

export function NeoPopLab() {
	const [geometry, setGeometry] = useState(PRESETS.Balanced);
	const [displayHeight, setDisplayHeight] = useState(220);
	const [paletteName, setPaletteName] = useState('Pop');
	const [copied, setCopied] = useState(false);
	const palette = PALETTES[paletteName];
	const update = (key: keyof NeoCodeMarkGeometry, value: number) =>
		setGeometry((current) => ({ ...current, [key]: value }));

	const copySvg = async () => {
		await navigator.clipboard.writeText(buildNeoCodeMarkSvg(geometry, palette));
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	const downloadSvg = () => {
		const blob = new Blob([buildNeoCodeMarkSvg(geometry, palette)], {
			type: 'image/svg+xml',
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'otto-code-mark.svg';
		anchor.click();
		URL.revokeObjectURL(url);
	};

	return (
		<main className="relative min-h-screen overflow-hidden pb-24 pt-28">
			<div
				aria-hidden="true"
				className="np-grid-bg absolute inset-0 opacity-45"
			/>
			<div className="relative mx-auto min-w-0 w-full max-w-[1180px] px-5 sm:px-8 lg:px-12">
				<div className="mb-8 min-w-0 max-w-[720px]">
					<p className="np-eyebrow text-np-blue">
						Internal playground / NeoPOP
					</p>
					<h1 className="np-title mt-4 text-otto-text">Custom asset lab</h1>
					<p className="mt-4 text-[14px] leading-relaxed text-otto-muted sm:text-[16px]">
						This mark is custom vector geometry—not a font glyph. Tune its
						shape, size, spacing, corners, and hard extrusion, then copy or
						download the SVG.
					</p>
				</div>

				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
					<div className="min-w-0 space-y-7">
						<NeoBox
							tone="card"
							accent="blue"
							elevation="lg"
							className="relative flex min-h-[420px] items-center justify-center overflow-hidden p-8 sm:min-h-[540px]"
						>
							<div
								aria-hidden="true"
								className="np-grid-bg absolute inset-0 opacity-30"
							/>
							<NeoCodeMark
								geometry={geometry}
								palette={palette}
								displayHeight={displayHeight}
								className="relative"
							/>
						</NeoBox>

						<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
							<NeoButton tone="blue" onClick={copySvg}>
								{copied ? 'SVG copied' : 'Copy SVG'}
							</NeoButton>
							<NeoButton variant="outline" onClick={downloadSvg}>
								Download SVG
							</NeoButton>
							<NeoButton href="/" variant="ghost">
								Back to landing page
							</NeoButton>
						</div>
					</div>

					<NeoBox tone="surface" elevation="md" className="h-fit p-5 sm:p-6">
						<div className="space-y-7">
							<fieldset>
								<legend className="np-eyebrow mb-3 text-otto-dim">
									Shape preset
								</legend>
								<div className="grid grid-cols-2 gap-2">
									{Object.entries(PRESETS).map(([name, preset]) => (
										<button
											type="button"
											key={name}
											onClick={() => setGeometry(preset)}
											className="np-edge rounded-[3px] bg-otto-card px-3 py-2 text-[12px] text-otto-text hover:bg-otto-border"
										>
											{name}
										</button>
									))}
								</div>
							</fieldset>

							<div className="space-y-5 border-t border-otto-border pt-6">
								<RangeField
									label="Display size"
									value={displayHeight}
									min={96}
									max={320}
									onChange={setDisplayHeight}
								/>
								<RangeField
									label="Arm length"
									value={geometry.arm}
									min={32}
									max={100}
									onChange={(value) => update('arm', value)}
								/>
								<RangeField
									label="Thickness"
									value={geometry.thickness}
									min={8}
									max={40}
									onChange={(value) => update('thickness', value)}
								/>
								<RangeField
									label="Inner gap"
									value={geometry.gap}
									min={8}
									max={110}
									onChange={(value) => update('gap', value)}
								/>
								<RangeField
									label="Corner shape"
									value={geometry.corner}
									min={0}
									max={18}
									onChange={(value) => update('corner', value)}
								/>
								<RangeField
									label="Extrusion"
									value={geometry.depth}
									min={0}
									max={24}
									onChange={(value) => update('depth', value)}
								/>
							</div>

							<fieldset className="border-t border-otto-border pt-6">
								<legend className="np-eyebrow mb-3 text-otto-dim">
									Palette
								</legend>
								<div className="flex gap-2">
									{Object.keys(PALETTES).map((name) => (
										<button
											type="button"
											key={name}
											onClick={() => setPaletteName(name)}
											className={`np-edge rounded-[3px] px-3 py-2 text-[12px] ${paletteName === name ? 'bg-otto-text text-otto-bg' : 'bg-otto-card text-otto-text'}`}
										>
											{name}
										</button>
									))}
								</div>
							</fieldset>
						</div>
					</NeoBox>
				</div>
			</div>
		</main>
	);
}
