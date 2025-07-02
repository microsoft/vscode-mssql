const vscodel10n = require('@vscode/l10n-dev');
const fs = require('fs').promises;

// Method that extracts all l10n.t calls from the source files and returns the l10n JSON object.
async function getL10nJson() {
    const srcFiles = await fs.readdir("./src", {
        recursive: true,
    });
    const tsFiles = srcFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

    const fileContents = [];
    for (const file of tsFiles) {
        const content = await fs.readFile(path.resolve("./src", file), "utf8");
        if (content) {
            fileContents.push({
                contents: content,
                extension: file.endsWith(".tsx") ? ".tsx" : ".ts",
            });
        }
    }
    const result = await vscodel10n.getL10nJson(
        fileContents.map((f) => {
            return {
                contents: f.contents,
                extension: f.extension,
            };
        }),
    );
    return result;
}

const bundleJSON = await getL10nJson();
const map = new Map();
map.set("package", JSON.parse(await fs.readFile(path.resolve("package.nls.json"), "utf8")));
map.set("bundle", bundleJSON);
const stringBundle = JSON.stringify(bundleJSON, null, 2);
await fs.writeFile("./localization/l10n/bundle.l10n.json", stringBundle);
const stringXLIFF = vscodel10n.getL10nXlf(map);
await fs.writeFile("./localization/xliff/vscode-mssql.xlf", stringXLIFF);
