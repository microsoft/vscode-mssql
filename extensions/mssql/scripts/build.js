const { execSync } = require("child_process");

const isProd = process.argv.includes("--prod");
const skipLocalization = process.argv.includes("--skip-localization");
const prodArg = isProd ? "--prod" : "";

try {
    if (skipLocalization) {
        execSync("yarn build:copy-assets", { stdio: "inherit" });
    } else {
        execSync("yarn build:prepare", { stdio: "inherit" });
    }
    execSync("yarn build:extension", { stdio: "inherit" });
    execSync(`yarn build:extension-bundle ${prodArg}`, { stdio: "inherit" });
    execSync(`yarn build:webviews`, { stdio: "inherit" });
    execSync(`yarn build:webviews-bundle ${prodArg}`, { stdio: "inherit" });
    execSync(`yarn build:notebook-renderer-bundle ${prodArg}`, { stdio: "inherit" });
} catch (error) {
    process.exit(1);
}
