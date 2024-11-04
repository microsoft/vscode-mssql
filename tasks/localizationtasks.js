var gulp = require('gulp')
var path = require('path');
const run = require('gulp-run-command').default;
const vscodel10n = require('@vscode/l10n-dev');
const fs = require('fs').promises;
const xliff = require('xliff');

const iso639_3_to_2 = {
	chs: 'zh-cn',
	cht: 'zh-tw',
	csy: 'cs-cz',
	deu: 'de',
	enu: 'en',
	esn: 'es',
	fra: 'fr',
	hun: 'hu',
	ita: 'it',
	jpn: 'ja',
	kor: 'ko',
	nld: 'nl',
	plk: 'pl',
	ptb: 'pt-br',
	ptg: 'pt',
	rus: 'ru',
	sve: 'sv-se',
	trk: 'tr'
};

const supportedLocLangs = [
	'chs',
	'cht',
	'deu',
	'esn',
	'fra',
	'ita',
	'jpn',
	'kor',
	'ptb',
	'rus',
];

// Method that extracts all l10n.t calls from the source files and returns the l10n JSON object.
async function getL10nJson() {
	const srcFiles = await fs.readdir('./src', {
		recursive: true
	});
	const tsFiles = srcFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

	const fileContents = [];
	for (const file of tsFiles) {
		const content = await fs.readFile(path.resolve('./src', file), 'utf8');
		if (content) {
			fileContents.push({
				contents: content,
				extension: file.endsWith('.tsx') ? '.tsx' : '.ts'
			});
		}
	}
	const result = await vscodel10n.getL10nJson(fileContents.map(f => {
		return {
			contents: f.contents,
			extension: f.extension
		};
	}));
	return result;
}

/**
 * Generates all the runtime localization files from the xliff files.
 * For each language, it reads the xliff file, extracts the strings and writes them to the respective l10n and nls files.
 */
gulp.task('ext:generate-runtime-localization-files', async function () {
	const xliffFiles = (await fs.readdir('./localization/xliff')).filter(f => f.endsWith('.xlf'));
	for (const xliffFile of xliffFiles) {
		if (xliffFile === 'vscode-mssql.xlf') {
			continue;
		}
		const xliffFileContents = await fs.readFile(path.resolve('./localization/xliff', xliffFile), 'utf8');
		const l10nDir = path.resolve(__dirname, '..', 'localization', 'l10n');
		const packageDir = path.resolve(__dirname, '..');
		const l10nDetailsArrayFromXlf = await vscodel10n.getL10nFilesFromXlf(xliffFileContents);
		for (fileContent of l10nDetailsArrayFromXlf) {
			if (fileContent.name === 'bundle') {
				let fileName = `bundle.l10n.${fileContent.language}.json`;
				if (fileContent.language === 'enu') {
					fileName = 'bundle.l10n.json';
				}
				const filePath = path.resolve(l10nDir, fileName);
				await fs.writeFile(filePath, JSON.stringify(fileContent.messages, null, 2));
			} else if (fileContent.name === 'package') {
				if (fileContent.language === 'enu') { // We don't need the enu nls file as it is edited manually by us.
					continue;
				}
				const fileName = `package.nls.${fileContent.language}.json`;
				const filePath = path.resolve(packageDir, fileName);
				await fs.writeFile(filePath, JSON.stringify(fileContent.messages, null, 2));
			}
		}
	}
});

/**
 *  UNUSED task.
 *  loc task that creates xliff files for all supported languages from the enu.xlf file
 */
gulp.task('ext:generate-xliff-files', async function () {
	const enuXlifFile = await fs.readFile('./localization/xliff/enu.xlf', 'utf8');
	const enuXlif = await xliff.xliff12ToJs(enuXlifFile);
	for (const lang of supportedLocLangs) {
		if (lang === 'enu') {
			continue;
		}
		console.error('Processing', lang);
		const existingXlifFile = await fs.readFile(`./localization/xliff/${lang}.xlf`, 'utf8');
		const existingXlif = await xliff.xliff12ToJs(existingXlifFile);
		const copyOfEnuXlif = JSON.parse(JSON.stringify(enuXlif));
		copyOfEnuXlif.targetLanguage = existingXlif.targetLanguage;

		const resourceTypes = ['bundle', 'package'];

		for (const resourceType of resourceTypes) {
			for (const key of Object.keys(copyOfEnuXlif.resources[resourceType])) {
				const target = existingXlif.resources[resourceType][key].target;
				if (target) {
					copyOfEnuXlif.resources[resourceType][key].target = target;
				}
			}
		}

		const newFile = await xliff.jsToXliff12(copyOfEnuXlif);
		await fs.writeFile(`./localization/xliff/${lang}.xlf`, newFile.toString());
	}
});

/**
 * Generates the enu.xlf file from the l10n strings and package.nls.json.
 * The file will be used to generate the xliff files for all the supported languages
 * Must be run whenever there is a change in the l10n strings or package.nls.json
 */
gulp.task('ext:extract-localization-strings', async function () {
	const bundleJSON = await getL10nJson();
	const map = new Map();
	map.set('package', JSON.parse(await fs.readFile(path.resolve('package.nls.json'), 'utf8')));
	map.set('bundle', bundleJSON);
	const stringBundle = JSON.stringify(bundleJSON, null, 2);
	await fs.writeFile('./localization/l10n/bundle.l10n.json', stringBundle);
	const stringXLIFF = vscodel10n.getL10nXlf(map);
	await fs.writeFile('./localization/xliff/vscode-mssql.xlf', stringXLIFF);

});

/**
 * UNUSED task.
 * Generates the pseudo localized l10n and nls files. For testing if localization is working correctly.
 */
gulp.task('ext:generate-pseudo-loc', gulp.series(
	'ext:extract-localization-strings',
	async function () {
		const bundle = await getL10nJson();
		const packageJson = await fs.readFile(path.resolve('package.nls.json'), 'utf8');
		const pseudoLocBundle = await vscodel10n.getL10nPseudoLocalized(bundle);
		const pseudoLocPackage = await vscodel10n.getL10nPseudoLocalized(JSON.parse(packageJson));
		await fs.writeFile('./localization/l10n/bundle.l10n.qps-ploc.json', JSON.stringify(pseudoLocBundle, null, 2));
		await fs.writeFile('./package.nls.qps-ploc.json', JSON.stringify(pseudoLocPackage, null, 2));
	}
))