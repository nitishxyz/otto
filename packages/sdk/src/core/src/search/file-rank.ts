export type FilePathMatch = { match: boolean; score: number };

const EXACT_FILENAME_SCORE = 10_000;
const PREFIX_FILENAME_SCORE = 9_000;
const SUBSTRING_FILENAME_SCORE = 8_000;
const SUBSTRING_PATH_SCORE = 7_000;
const EXACT_STEM_SCORE = 6_000;
const PREFIX_STEM_SCORE = 5_500;
const SUBSTRING_STEM_SCORE = 5_000;
const FUZZY_FILENAME_SCORE = 1_000;

function fileName(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function explicitExtension(name: string): string | undefined {
	const dotIndex = name.lastIndexOf('.');
	if (dotIndex <= 0 || dotIndex === name.length - 1) return undefined;
	return name.slice(dotIndex + 1);
}

function stripExtension(name: string): string {
	const dotIndex = name.lastIndexOf('.');
	if (dotIndex <= 0) return name;
	return name.slice(0, dotIndex);
}

function extensionMatches(
	queryExtension: string,
	targetExtension: string,
): boolean {
	if (queryExtension.length >= 2) return targetExtension === queryExtension;
	return targetExtension.startsWith(queryExtension);
}

function scoreWithPenalty(baseScore: number, path: string, index = 0): number {
	return baseScore - index - Math.min(path.length, 500) / 1000;
}

function fuzzyScore(query: string, target: string): FilePathMatch {
	if (!query) return { match: true, score: 0 };

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;

	for (
		let targetIndex = 0;
		targetIndex < target.length && queryIndex < query.length;
		targetIndex++
	) {
		if (target[targetIndex] === query[queryIndex]) {
			score += 10;
			if (lastMatchIndex === targetIndex - 1) score += 5;
			if (
				targetIndex === 0 ||
				target[targetIndex - 1] === '/' ||
				target[targetIndex - 1] === '-' ||
				target[targetIndex - 1] === '_' ||
				target[targetIndex - 1] === '.'
			) {
				score += 8;
			}
			lastMatchIndex = targetIndex;
			queryIndex++;
		}
	}

	return { match: queryIndex === query.length, score };
}

/**
 * Score a file path against a quick-open query, prioritizing filename matches.
 */
export function fuzzyMatchFilePath(
	query: string,
	target: string,
): FilePathMatch {
	const normalizedQuery = query.trim().toLowerCase();
	const normalizedTarget = target.toLowerCase();

	if (normalizedQuery.length === 0) return { match: true, score: 0 };

	const queryFileName = fileName(normalizedQuery);
	const targetFileName = fileName(normalizedTarget);
	const queryExtension = explicitExtension(queryFileName);
	const targetExtension = explicitExtension(targetFileName) ?? '';

	if (queryExtension && !extensionMatches(queryExtension, targetExtension)) {
		return { match: false, score: 0 };
	}

	if (targetFileName === queryFileName) {
		return {
			match: true,
			score: scoreWithPenalty(EXACT_FILENAME_SCORE, normalizedTarget),
		};
	}

	if (targetFileName.startsWith(queryFileName)) {
		return {
			match: true,
			score: scoreWithPenalty(PREFIX_FILENAME_SCORE, normalizedTarget),
		};
	}

	const filenameIndex = targetFileName.indexOf(queryFileName);
	if (filenameIndex >= 0) {
		return {
			match: true,
			score: scoreWithPenalty(
				SUBSTRING_FILENAME_SCORE,
				normalizedTarget,
				filenameIndex,
			),
		};
	}

	const pathIndex = normalizedTarget.indexOf(normalizedQuery);
	if (pathIndex >= 0) {
		return {
			match: true,
			score: scoreWithPenalty(
				SUBSTRING_PATH_SCORE,
				normalizedTarget,
				pathIndex,
			),
		};
	}

	const queryStem = queryExtension
		? stripExtension(queryFileName)
		: queryFileName;
	const targetStem = queryExtension
		? stripExtension(targetFileName)
		: targetFileName;

	if (queryStem.length === 0) return { match: false, score: 0 };

	if (targetStem === queryStem) {
		return {
			match: true,
			score: scoreWithPenalty(EXACT_STEM_SCORE, normalizedTarget),
		};
	}

	if (targetStem.startsWith(queryStem)) {
		return {
			match: true,
			score: scoreWithPenalty(PREFIX_STEM_SCORE, normalizedTarget),
		};
	}

	const stemIndex = targetStem.indexOf(queryStem);
	if (stemIndex >= 0) {
		return {
			match: true,
			score: scoreWithPenalty(
				SUBSTRING_STEM_SCORE,
				normalizedTarget,
				stemIndex,
			),
		};
	}

	const filenameFuzzy = fuzzyScore(queryStem, targetStem);
	if (filenameFuzzy.match) {
		return {
			match: true,
			score:
				FUZZY_FILENAME_SCORE +
				filenameFuzzy.score -
				Math.min(normalizedTarget.length, 500) / 1000,
		};
	}

	if (!normalizedQuery.includes('/')) return { match: false, score: 0 };

	return fuzzyScore(normalizedQuery, normalizedTarget);
}
