const { execSync } = require("child_process");

const isProd = process.argv.includes("--prod");
const prodArg = isProd ? "--prod" : "";

try {
    execSync("yarn build:prepare", { stdio: "inherit" });
    execSync("yarn build:extension", { stdio: "inherit" });
    execSync(`yarn build:extension-bundle ${prodArg}`, { stdio: "inherit" });
    execSync(`yarn build:webviews`, { stdio: "inherit" });
    execSync(`yarn build:webviews-bundle ${prodArg}`, { stdio: "inherit" });
} catch (error) {
    process.exit(1);
}
