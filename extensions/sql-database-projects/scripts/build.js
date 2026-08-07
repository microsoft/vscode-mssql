const { execFileSync } = require("child_process");

const npmCommand = "npm";
const execOptions = { stdio: "inherit", shell: process.platform === "win32" };
const bundleArgs = process.argv.slice(2);

try {
    execFileSync(npmCommand, ["run", "build:prepare"], execOptions);
    execFileSync(npmCommand, ["run", "build:extension"], execOptions);
    execFileSync(
        npmCommand,
        ["run", "build:extension-bundle", ...(bundleArgs.length > 0 ? ["--", ...bundleArgs] : [])],
        execOptions,
    );
} catch (error) {
    process.exit(1);
}
