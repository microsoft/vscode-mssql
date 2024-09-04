var dom = require('@xmldom/xmldom').DOMParser
var gulp = require('gulp')
var config = require('./config')
var through = require('through2');
var path = require('path');
const run = require('gulp-run-command').default;
const vscodel10n = require('@vscode/l10n-dev');
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

gulp.task('ext:extract-localization-strings', gulp.series(
	run('npx @vscode/l10n-dev extract -o ./localization/l10n ./src'), // Extracts strings from the source code and writes them to the localization/l10n folder
	run('npx @vscode/l10n-dev generate-xlf -o ./localization/xliff/enu.xlf ./localization/l10n/bundle.l10n.json ./package.nls.json') // Generates an XLF file from the extracted strings
));


gulp.task('ext:generate-runtime-localization-files', async function () { // Generates the localization files for all supported languages to be used in the extension
	const fs = require('fs').promises;
	for (const lang of supportedLocLangs) {
		if (lang === 'enu') {
			continue;
		}
		console.error('Processing', lang);
		const xlifFile = await fs.readFile(`./localization/xliff/${lang}.xlf`, 'utf8');
		const l10nDir = path.resolve(__dirname, '..', 'localization', 'l10n');
		const packageDir = path.resolve(__dirname, '..');
		const l10nDetailsArrayFromXlf = await vscodel10n.getL10nFilesFromXlf(xlifFile);
		for (fileContent of l10nDetailsArrayFromXlf) {
			console.log('Processing file', fileContent.name);
			if (fileContent.name === 'bundle') {
				const fileName = `bundle.l10n.${fileContent.language}.json`;
				const filePath = path.resolve(l10nDir, fileName);
				console.log('Writing to', filePath);
				await fs.writeFile(filePath, JSON.stringify(fileContent.messages, null, 4));
			} else if (fileContent.name === 'package') {
				const fileName = `package.nls.${fileContent.language}.json`;
				const filePath = path.resolve(packageDir, fileName);
				console.log('Writing to', filePath);
				await fs.writeFile(filePath, JSON.stringify(fileContent.messages, null, 4));
			}
		}
	}
});