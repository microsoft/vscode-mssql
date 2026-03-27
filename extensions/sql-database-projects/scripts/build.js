const { execFileSync } = require("child_process");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
    execFileSync(npmCommand, ["run", "build:prepare"], { stdio: "inherit" });
    execFileSync(npmCommand, ["run", "build:extension"], { stdio: "inherit" });
} catch (error) {
    process.exit(1);
}
