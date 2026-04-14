const { execFileSync } = require("child_process");

const npmCommand = "npm";
const execOptions = { stdio: "inherit", shell: process.platform === "win32" };

try {
    execFileSync(npmCommand, ["run", "build:prepare"], execOptions);
    execFileSync(npmCommand, ["run", "build:extension"], execOptions);
} catch (error) {
    process.exit(1);
}
