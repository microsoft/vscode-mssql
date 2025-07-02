const fs = require('fs').promises;
const path = require('path');
const vscodel10n = require('@vscode/l10n-dev');

async function generateRuntimeLocalizationFiles() {
    try {
        const xliffFiles = (await fs.readdir('./localization/xliff')).filter(f => f.endsWith('.xlf'));

        for (const xliffFile of xliffFiles) {
            if (xliffFile === 'vscode-mssql.xlf') {
                continue;
            }

            const xliffFileContents = await fs.readFile(path.resolve('./localization/xliff', xliffFile), 'utf8');
            const l10nDir = path.resolve(__dirname, '..', 'localization', 'l10n');
            const packageDir = path.resolve(__dirname, '..');
            const l10nDetailsArrayFromXlf = await vscodel10n.getL10nFilesFromXlf(xliffFileContents);

            for (const fileContent of l10nDetailsArrayFromXlf) {
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

        console.log('Runtime localization files generated successfully');
    } catch (error) {
        console.error('Error generating runtime localization files:', error);
        process.exit(1);
    }
}

if (require.main === module) {
	generateRuntimeLocalizationFiles();
}

module.exports = { generateRuntimeLocalizationFiles };