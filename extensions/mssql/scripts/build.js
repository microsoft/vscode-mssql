const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const isProd = process.argv.includes("--prod");
const prodArg = isProd ? "--prod" : "";

function ensureSqlCommonBuilt() {
    const repoRoot = path.resolve(__dirname, "../../..");
    const sqlCommonRoot = path.join(repoRoot, "packages", "vscode-sql-common");
    const sqlCommonTypings = path.join(sqlCommonRoot, "dist", "index.d.ts");

    if (!fs.existsSync(sqlCommonTypings)) {
        execSync(`yarn --cwd "${sqlCommonRoot}" install --frozen-lockfile`, { stdio: "inherit" });
        execSync(`yarn --cwd "${sqlCommonRoot}" build`, { stdio: "inherit" });
    }
}

try {
    ensureSqlCommonBuilt();
    execSync("yarn build:prepare", { stdio: "inherit" });
    execSync("yarn build:extension", { stdio: "inherit" });
    execSync(`yarn build:extension-bundle ${prodArg}`, { stdio: "inherit" });
    execSync(`yarn build:webviews`, { stdio: "inherit" });
    execSync(`yarn build:webviews-bundle ${prodArg}`, { stdio: "inherit" });
    execSync(`yarn build:notebook-renderer-bundle ${prodArg}`, { stdio: "inherit" });
} catch (error) {
    process.exit(1);
}
