const { execFileSync } = require("child_process");

const npmCommand = "npm";
const execOptions = { stdio: "inherit", shell: process.platform === "win32" };

const isProd = process.argv.includes("--prod");

function runScript(scriptName, args = []) {
    const npmArgs = ["run", scriptName];

    if (args.length > 0) {
        npmArgs.push("--", ...args);
    }

    execFileSync(npmCommand, npmArgs, execOptions);
}

try {
    const bundleArgs = isProd ? ["--prod"] : [];

    runScript("build:prepare");
    runScript("build:extension");
    runScript("build:extension-bundle", bundleArgs);
    runScript("build:webviews");
    runScript("build:webviews-bundle", bundleArgs);
    runScript("build:notebook-renderer-bundle", bundleArgs);
} catch (error) {
    process.exit(1);
}
