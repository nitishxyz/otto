import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageJson {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

/**
 * Replace workspace:* dependencies with actual version from package.json
 */
function replaceWorkspaceDependencies(
	packagePath: string,
	workspaceVersions: Map<string, string>,
): void {
	const content = readFileSync(packagePath, 'utf8');
	const pkg = JSON.parse(content) as PackageJson;

	let modified = false;

	const sections: Array<keyof PackageJson> = [
		'dependencies',
		'devDependencies',
		'peerDependencies',
	];

	for (const section of sections) {
		const deps = pkg[section];
		if (!deps || typeof deps !== 'object') continue;

		for (const [depName, depVersion] of Object.entries(deps)) {
			if (depVersion === 'workspace:*') {
				const actualVersion = workspaceVersions.get(depName);
				if (!actualVersion) {
					throw new Error(
						`Cannot find version for workspace dependency: ${depName}`,
					);
				}
				deps[depName] = actualVersion;
				modified = true;
				console.log(`  ${depName}: workspace:* → ${actualVersion}`);
			}
		}
	}

	if (modified) {
		writeFileSync(packagePath, `${JSON.stringify(pkg, null, '\t')}\n`);
		console.log(`✓ Updated ${packagePath}`);
	}
}

function main() {
	const packages = [
		'packages/api',
		'packages/sdk',
		'packages/web-ui',
		'packages/web-sdk',
		'packages/install',
		'packages/database',
		'packages/themes',
		'packages/server',
	];

	const versionOnlyPackages = ['packages/ai-sdk'];

	// First, collect all workspace package versions
	const workspaceVersions = new Map<string, string>();

	for (const pkgPath of [...packages, ...versionOnlyPackages]) {
		const packagePath = resolve(process.cwd(), pkgPath, 'package.json');
		const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageJson;

		if (pkg.name && pkg.version) {
			workspaceVersions.set(pkg.name, pkg.version);
		}
	}

	console.log('\n=== Workspace Versions ===');
	for (const [name, version] of workspaceVersions) {
		console.log(`${name}: ${version}`);
	}

	console.log('\n=== Replacing workspace:* dependencies ===');

	// Then, replace workspace:* in all packages
	for (const pkgPath of packages) {
		const packagePath = resolve(process.cwd(), pkgPath, 'package.json');
		replaceWorkspaceDependencies(packagePath, workspaceVersions);
	}

	console.log('\n✓ All workspace dependencies replaced with versions');
}

main();
