import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');
const ranks: Record<string, number> = {
	database: 0,
	install: 0,
	sdk: 1,
	api: 2,
	server: 3,
	'web-sdk': 4,
};

function imports(source: string, file: string): string[] {
	const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const result: string[] = [];
	function visit(node: ts.Node): void {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		)
			result.push(node.moduleSpecifier.text);
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) &&
					node.expression.text === 'require')) &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		)
			result.push(node.arguments[0].text);
		ts.forEachChild(node, visit);
	}
	visit(tree);
	return result;
}

test('production imports respect package direction and public entrypoints', () => {
	const violations: string[] = [];
	const files = [
		...new Bun.Glob('{packages,apps}/*/src/**/*.{ts,tsx,js,jsx}').scanSync({
			cwd: root,
			onlyFiles: true,
		}),
		...new Bun.Glob('{packages,apps}/*/index.{ts,tsx,js,jsx}').scanSync({
			cwd: root,
			onlyFiles: true,
		}),
	];
	expect(files.length).toBeGreaterThan(0);
	for (const file of files) {
		if (/\.(test|spec)\./.test(file) || file.includes('/tests/')) continue;
		const [kind, owner] = file.split('/');
		const rank = kind === 'apps' ? 5 : ranks[owner];
		for (const specifier of imports(
			readFileSync(join(root, file), 'utf8'),
			file,
		)) {
			const target = specifier.match(/^@ottocode\/([^/]+)(.*)$/);
			if (target) {
				if (target[2].startsWith('/src/'))
					violations.push(`${file}: cross-package source import ${specifier}`);
				if (
					rank !== undefined &&
					ranks[target[1]] !== undefined &&
					ranks[target[1]] > rank
				)
					violations.push(`${file}: inverted dependency ${specifier}`);
			} else if (specifier.startsWith('.')) {
				const resolved = relative(root, resolve(root, file, '..', specifier));
				// Private Astro preview bundles message components with its API client stub alias.
				if (
					kind === 'apps' &&
					owner === 'preview-web' &&
					resolved.startsWith('packages/web-sdk/src/')
				)
					continue;
				const [targetKind, targetOwner, segment] = resolved.split('/');
				if (
					(targetKind === 'packages' || targetKind === 'apps') &&
					(targetKind !== kind || targetOwner !== owner) &&
					segment === 'src'
				)
					violations.push(`${file}: cross-package source import ${specifier}`);
			}
		}
	}
	expect(violations).toEqual([]);
});

test('SDK browser entrypoint bundles without process-host builtins', async () => {
	const result = await Bun.build({
		entrypoints: [join(root, 'packages/sdk/src/browser.ts')],
		target: 'browser',
		write: false,
	});
	expect(result.success).toBe(true);
	if (!result.success) throw new Error(result.logs.map(String).join('\n'));
	for (const output of result.outputs)
		expect(await output.text()).not.toMatch(
			/(?:from\s*|import\s*\()["'](?:bun:|node:)/,
		);
});
