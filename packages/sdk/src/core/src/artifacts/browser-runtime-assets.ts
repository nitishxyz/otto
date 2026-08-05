import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import LUCIDE_REACT_SOURCE from './browser-runtime/lucide-react.txt' with {
	type: 'text',
};
import MOTION_SOURCE from './browser-runtime/motion.txt' with { type: 'text' };
import OTTO_ARTIFACT_SOURCE from './browser-runtime/otto-artifact.txt' with {
	type: 'text',
};
import REACT_DOM_CLIENT_SOURCE from './browser-runtime/react-dom-client.txt' with {
	type: 'text',
};
import REACT_DOM_SOURCE from './browser-runtime/react-dom.txt' with {
	type: 'text',
};
import REACT_JSX_DEV_RUNTIME_SOURCE from './browser-runtime/react-jsx-dev-runtime.txt' with {
	type: 'text',
};
import REACT_JSX_RUNTIME_SOURCE from './browser-runtime/react-jsx-runtime.txt' with {
	type: 'text',
};
import REACT_SOURCE from './browser-runtime/react.txt' with { type: 'text' };
import RUNTIME_HASH from './browser-runtime/runtime-hash.txt' with {
	type: 'text',
};

const BROWSER_RUNTIME_DIRECTORY = 'otto-runtime';

export const CURATED_BROWSER_RUNTIME_HASH = RUNTIME_HASH.trim();

const BROWSER_RUNTIME_ASSETS = {
	'react.js': REACT_SOURCE,
	'react-jsx-runtime.js': REACT_JSX_RUNTIME_SOURCE,
	'react-jsx-dev-runtime.js': REACT_JSX_DEV_RUNTIME_SOURCE,
	'react-dom.js': REACT_DOM_SOURCE,
	'react-dom-client.js': REACT_DOM_CLIENT_SOURCE,
	'motion.js': MOTION_SOURCE,
	'lucide-react.js': LUCIDE_REACT_SOURCE,
	'otto-artifact.js': OTTO_ARTIFACT_SOURCE,
} as const;

const CURATED_BROWSER_MODULES: Record<string, string> = {
	react: 'react.js',
	'react/jsx-runtime': 'react-jsx-runtime.js',
	'react/jsx-dev-runtime': 'react-jsx-dev-runtime.js',
	'react-dom': 'react-dom.js',
	'react-dom/client': 'react-dom-client.js',
	motion: 'motion.js',
	'motion/react': 'motion.js',
	'lucide-react': 'lucide-react.js',
	'@otto/artifact': 'otto-artifact.js',
};

export const CURATED_BROWSER_IMPORTS = Object.freeze(
	Object.keys(CURATED_BROWSER_MODULES),
);

/** Maps a curated package import to its local browser module. */
export function resolveCuratedBrowserImport(
	specifier: string,
): string | undefined {
	const file = CURATED_BROWSER_MODULES[specifier];
	return file ? `./${BROWSER_RUNTIME_DIRECTORY}/${file}` : undefined;
}

/** Rewrites external package specifiers to browser modules beside a build. */
export function rewriteCuratedBrowserImports(source: string): string {
	let rewritten = source;
	for (const specifier of CURATED_BROWSER_IMPORTS) {
		const target = resolveCuratedBrowserImport(specifier);
		if (!target) continue;
		rewritten = rewritten
			.replaceAll(JSON.stringify(specifier), JSON.stringify(target))
			.replaceAll(`'${specifier}'`, `'${target}'`);
	}
	return rewritten;
}

/** Writes the browser-only runtime embedded in the Otto executable. */
export async function writeCuratedBrowserRuntime(
	buildRoot: string,
): Promise<void> {
	const runtimeRoot = join(buildRoot, BROWSER_RUNTIME_DIRECTORY);
	await mkdir(runtimeRoot, { recursive: true });
	await Promise.all(
		Object.entries(BROWSER_RUNTIME_ASSETS).map(([name, source]) =>
			writeFile(join(runtimeRoot, name), source),
		),
	);
}
