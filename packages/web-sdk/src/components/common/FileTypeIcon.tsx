import { Icon, addCollection } from '@iconify/react';
import { icons as materialIconTheme } from '@iconify-json/material-icon-theme';

addCollection(materialIconTheme);

const DEFAULT_FILE_ICON_CLASS = 'h-3.5 w-3.5 shrink-0';

const FILENAME_ICON_MAP: Record<string, string> = {
	'.dockerignore': 'docker',
	'.editorconfig': 'editorconfig',
	'.env': 'settings',
	'.env.example': 'settings',
	'.env.local': 'settings',
	'.eslintignore': 'eslint',
	'.eslintrc': 'eslint',
	'.gitattributes': 'git',
	'.gitignore': 'git',
	'.prettierrc': 'prettier',
	'astro.config.mjs': 'astro-config',
	'astro.config.ts': 'astro-config',
	'biome.json': 'biome',
	'bun.lock': 'bun',
	'bun.lockb': 'bun',
	'bunfig.toml': 'bun',
	'cargo.lock': 'lock',
	'cargo.toml': 'rust',
	'compose.yaml': 'docker',
	'compose.yml': 'docker',
	'docker-compose.yaml': 'docker',
	'docker-compose.yml': 'docker',
	dockerfile: 'docker',
	'eslint.config.js': 'eslint',
	'eslint.config.mjs': 'eslint',
	'eslint.config.ts': 'eslint',
	gemfile: 'gemfile',
	'go.mod': 'go-mod',
	'go.sum': 'go-mod',
	'jsconfig.json': 'jsconfig',
	license: 'license',
	makefile: 'makefile',
	'next.config.js': 'next',
	'next.config.mjs': 'next',
	'next.config.ts': 'next',
	'package-lock.json': 'npm',
	'package.json': 'npm',
	'pnpm-lock.yaml': 'pnpm',
	'postcss.config.js': 'postcss',
	'postcss.config.mjs': 'postcss',
	'postcss.config.ts': 'postcss',
	'prettier.config.js': 'prettier',
	'prettier.config.mjs': 'prettier',
	'prettier.config.ts': 'prettier',
	'readme.md': 'readme',
	'readme.mdx': 'readme',
	'rollup.config.js': 'rollup',
	'rollup.config.mjs': 'rollup',
	'rollup.config.ts': 'rollup',
	'svelte.config.js': 'svelte',
	'svelte.config.ts': 'svelte',
	'tailwind.config.js': 'tailwindcss',
	'tailwind.config.ts': 'tailwindcss',
	'tauri.conf.json': 'tauri',
	'tsconfig.json': 'tsconfig',
	'vite.config.js': 'vite',
	'vite.config.mjs': 'vite',
	'vite.config.ts': 'vite',
	'vitest.config.js': 'vitest',
	'vitest.config.mjs': 'vitest',
	'vitest.config.ts': 'vitest',
	'vue.config.js': 'vue-config',
	'vue.config.ts': 'vue-config',
	'yarn.lock': 'lock',
};

const EXTENSION_ICON_MAP: Record<string, string> = {
	ai: 'image',
	astro: 'astro',
	avif: 'image',
	bash: 'console',
	bmp: 'image',
	c: 'c',
	cc: 'cpp',
	clj: 'clojure',
	cljc: 'clojure',
	cljs: 'clojure',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	cxx: 'cpp',
	dart: 'dart',
	dockerfile: 'docker',
	ex: 'elixir',
	exs: 'elixir',
	erl: 'erlang',
	fish: 'console',
	gif: 'image',
	go: 'go',
	graphql: 'graphql',
	gql: 'graphql',
	groovy: 'groovy',
	h: 'c',
	hpp: 'cpp',
	hrl: 'erlang',
	hs: 'haskell',
	htm: 'html',
	html: 'html',
	hxx: 'cpp',
	ico: 'favicon',
	java: 'java',
	jpeg: 'image',
	jpg: 'image',
	js: 'javascript',
	json: 'json',
	jsonc: 'json',
	jsx: 'react',
	jl: 'julia',
	kt: 'kotlin',
	kts: 'kotlin',
	less: 'less',
	log: 'log',
	lua: 'lua',
	luau: 'luau',
	mjs: 'javascript',
	ml: 'ocaml',
	mli: 'ocaml',
	mov: 'video',
	mp3: 'audio',
	mp4: 'video',
	md: 'markdown',
	mdx: 'markdown',
	nim: 'nim',
	pdf: 'pdf',
	php: 'php-elephant',
	png: 'image',
	prisma: 'prisma',
	proto: 'proto',
	ps1: 'powershell',
	py: 'python',
	pyw: 'python',
	r: 'r',
	rb: 'ruby',
	rs: 'rust',
	sass: 'sass',
	scala: 'scala',
	scss: 'sass',
	sh: 'console',
	sql: 'database',
	svg: 'svg',
	svelte: 'svelte',
	swift: 'swift',
	toml: 'toml',
	ts: 'typescript',
	tsx: 'react-ts',
	txt: 'document',
	vue: 'vue',
	wav: 'audio',
	webm: 'video',
	webp: 'image',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
	zig: 'zig',
	zip: 'zip',
	zsh: 'console',
};

function getFileExtension(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	return extension && extension !== path.toLowerCase() ? extension : '';
}

function getFileName(path: string): string {
	return path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase();
}

/**
 * Returns the Material Icon Theme icon name for a file path.
 */
export function getFileIconName(path: string): string {
	const fileName = getFileName(path);
	const fileIcon = FILENAME_ICON_MAP[fileName];
	if (fileIcon) return fileIcon;

	if (fileName.endsWith('.d.ts')) return 'typescript-def';
	if (fileName.endsWith('.test.ts') || fileName.endsWith('.spec.ts')) {
		return 'test-ts';
	}
	if (fileName.endsWith('.test.js') || fileName.endsWith('.spec.js')) {
		return 'test-js';
	}
	if (
		fileName.endsWith('.test.jsx') ||
		fileName.endsWith('.spec.jsx') ||
		fileName.endsWith('.test.tsx') ||
		fileName.endsWith('.spec.tsx')
	) {
		return 'test-jsx';
	}

	const extension = getFileExtension(fileName);
	return EXTENSION_ICON_MAP[extension] ?? 'document';
}

interface FileTypeIconProps {
	path: string;
	className?: string;
}

/**
 * Renders the shared Material Icon Theme icon for a file path.
 */
export function FileTypeIcon({
	path,
	className = DEFAULT_FILE_ICON_CLASS,
}: FileTypeIconProps) {
	return (
		<Icon
			aria-hidden="true"
			className={className}
			icon={`material-icon-theme:${getFileIconName(path)}`}
		/>
	);
}
