import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

type ReleaseType = 'major' | 'minor' | 'patch' | 'prerelease';

interface CliArgs {
	type?: ReleaseType;
	preid?: string;
	dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { dryRun: false };

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];

		if (current === '--help' || current === '-h') {
			printUsage();
			process.exit(0);
		}

		if (current === '--dry-run') {
			args.dryRun = true;
			continue;
		}

		if (current === '--type') {
			const value = argv[index + 1];
			if (!value) {
				throw new Error('Missing value for --type');
			}

			args.type = castReleaseType(value);
			index += 1;
			continue;
		}

		if (current === '--preid') {
			const value = argv[index + 1];
			if (!value) {
				throw new Error('Missing value for --preid');
			}

			args.preid = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${current}`);
	}

	return args;
}

function castReleaseType(value: string): ReleaseType {
	const allowed: ReleaseType[] = ['major', 'minor', 'patch', 'prerelease'];
	if ((allowed as string[]).includes(value)) {
		return value as ReleaseType;
	}
	throw new Error(`Unsupported release type: ${value}`);
}

function incrementVersion(
	version: string,
	type: ReleaseType,
	preid?: string,
): string {
	const match = version.match(
		/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
	);
	if (!match) {
		throw new Error(`Invalid semver: ${version}`);
	}

	let [major, minor, patch] = match
		.slice(1, 4)
		.map((segment) => Number.parseInt(segment, 10));
	let pre: string | undefined = match[4];

	switch (type) {
		case 'major': {
			major += 1;
			minor = 0;
			patch = 0;
			pre = undefined;
			break;
		}
		case 'minor': {
			minor += 1;
			patch = 0;
			pre = undefined;
			break;
		}
		case 'patch': {
			if (pre) {
				pre = undefined;
			} else {
				patch += 1;
			}
			break;
		}
		case 'prerelease': {
			const identifier = preid ?? 'beta';
			if (!pre) {
				patch += 1;
				pre = `${identifier}.0`;
				break;
			}

			const nextPre = nextPreRelease(pre, identifier);
			pre = nextPre;
			break;
		}
	}

	return pre
		? `${major}.${minor}.${patch}-${pre}`
		: `${major}.${minor}.${patch}`;
}

function nextPreRelease(current: string, identifier: string): string {
	const lastDot = current.lastIndexOf('.');
	const baseId = lastDot === -1 ? current : current.slice(0, lastDot);
	const maybeNumber =
		lastDot === -1
			? Number.NaN
			: Number.parseInt(current.slice(lastDot + 1), 10);

	if (baseId === identifier && Number.isInteger(maybeNumber)) {
		return `${identifier}.${maybeNumber + 1}`;
	}

	return `${identifier}.0`;
}

function printUsage() {
	console.log(
		'Usage: bun run scripts/bump-version.ts --type <major|minor|patch|prerelease> [--preid beta] [--dry-run]',
	);
}

function updatePackageVersion(
	packagePath: string,
	nextVersion: string,
	dryRun: boolean,
): void {
	const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
		version?: string;
	};

	if (!packageJson.version) {
		throw new Error(`${packagePath} is missing a version field`);
	}

	if (!dryRun) {
		packageJson.version = nextVersion;
		writeFileSync(packagePath, `${JSON.stringify(packageJson, null, '\t')}\n`);
		console.log(`✓ Updated ${packagePath} to ${nextVersion}`);
	} else {
		console.log(`[DRY RUN] Would update ${packagePath} to ${nextVersion}`);
	}
}

function updateReadmeBadge(
	readmePath: string,
	nextVersion: string,
	dryRun: boolean,
): void {
	const content = readFileSync(readmePath, 'utf8');
	const updated = content.replace(
		/(https:\/\/img\.shields\.io\/badge\/version-)([0-9A-Za-z.-]+)(-blue)/,
		`$1${nextVersion}$3`,
	);

	if (updated === content) {
		throw new Error('README badge version not found');
	}

	if (!dryRun) {
		writeFileSync(readmePath, updated);
		console.log(`✓ Updated ${readmePath} badge to ${nextVersion}`);
	} else {
		console.log(`[DRY RUN] Would update ${readmePath} badge to ${nextVersion}`);
	}
}

function updateGettingStartedPin(
	gettingStartedPath: string,
	nextVersion: string,
	dryRun: boolean,
): void {
	const content = readFileSync(gettingStartedPath, 'utf8');
	const updated = content.replace(
		/OTTO_VERSION=v([0-9A-Za-z.-]+)\s+curl/,
		`OTTO_VERSION=v${nextVersion} curl`,
	);

	if (updated === content) {
		throw new Error('Getting started version pin not found');
	}

	if (!dryRun) {
		writeFileSync(gettingStartedPath, updated);
		console.log(
			`✓ Updated ${gettingStartedPath} version pin to ${nextVersion}`,
		);
	} else {
		console.log(
			`[DRY RUN] Would update ${gettingStartedPath} version pin to ${nextVersion}`,
		);
	}
}

function main() {
	const { type, preid, dryRun } = parseArgs(process.argv.slice(2));
	if (!type) {
		printUsage();
		throw new Error('--type is required');
	}

	const rootPackagePath = resolve(process.cwd(), 'package.json');
	const rootPackageJson = JSON.parse(readFileSync(rootPackagePath, 'utf8')) as {
		version?: string;
	};

	if (!rootPackageJson.version) {
		throw new Error('Root package.json is missing a version field');
	}

	const nextVersion = incrementVersion(rootPackageJson.version, type, preid);

	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}

	// Update root package.json
	updatePackageVersion(rootPackagePath, nextVersion, dryRun);

	// Update CLI package.json
	const cliPackagePath = resolve(process.cwd(), 'apps/cli/package.json');
	updatePackageVersion(cliPackagePath, nextVersion, dryRun);

	// Update web app package.json
	const webAppPackagePath = resolve(process.cwd(), 'apps/web/package.json');
	updatePackageVersion(webAppPackagePath, nextVersion, dryRun);

	// Update install package.json (moved to packages/)
	const installPackagePath = resolve(
		process.cwd(),
		'packages/install/package.json',
	);
	updatePackageVersion(installPackagePath, nextVersion, dryRun);

	// Update API package.json
	const apiPackagePath = resolve(process.cwd(), 'packages/api/package.json');
	updatePackageVersion(apiPackagePath, nextVersion, dryRun);

	// Update SDK package.json
	const sdkPackagePath = resolve(process.cwd(), 'packages/sdk/package.json');
	updatePackageVersion(sdkPackagePath, nextVersion, dryRun);

	// Update web-ui package.json
	const webUiPackagePath = resolve(
		process.cwd(),
		'packages/web-ui/package.json',
	);
	updatePackageVersion(webUiPackagePath, nextVersion, dryRun);

	// Update web-sdk package.json
	const webSdkPackagePath = resolve(
		process.cwd(),
		'packages/web-sdk/package.json',
	);
	updatePackageVersion(webSdkPackagePath, nextVersion, dryRun);

	// Update database package.json
	const databasePackagePath = resolve(
		process.cwd(),
		'packages/database/package.json',
	);
	updatePackageVersion(databasePackagePath, nextVersion, dryRun);

	// Update themes package.json
	const themesPackagePath = resolve(
		process.cwd(),
		'packages/themes/package.json',
	);
	updatePackageVersion(themesPackagePath, nextVersion, dryRun);

	// Update server package.json
	const serverPackagePath = resolve(
		process.cwd(),
		'packages/server/package.json',
	);
	updatePackageVersion(serverPackagePath, nextVersion, dryRun);

	// Update README badge
	const readmePath = resolve(process.cwd(), 'README.md');
	updateReadmeBadge(readmePath, nextVersion, dryRun);

	// Update Getting Started pinned version
	const gettingStartedPath = resolve(process.cwd(), 'docs/getting-started.md');
	updateGettingStartedPin(gettingStartedPath, nextVersion, dryRun);

	console.log(`\n✓ All packages updated to version: ${nextVersion}`);
}

main();
