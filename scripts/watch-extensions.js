#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listExtensionPackages(extensionsRoot) {
  if (!fs.existsSync(extensionsRoot)) {
    return [];
  }

  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => {
      const folderName = dirent.name;
      const packageJsonPath = path.join(
        extensionsRoot,
        folderName,
        "package.json",
      );
      if (!fs.existsSync(packageJsonPath)) {
        return null;
      }

      const pkg = readJson(packageJsonPath);
      const hasWatch = Boolean(pkg?.scripts?.watch);
      return {
        folderName,
        packageName: pkg?.name,
        hasWatch,
      };
    })
    .filter(Boolean);
}

function prefixStream(stream, prefix) {
  const rl = readline.createInterface({ input: stream });
  rl.on("line", (line) => {
    process.stdout.write(`[${prefix}] ${line}\n`);
  });
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const extensionsRoot = path.join(repoRoot, "extensions");

  const packages = listExtensionPackages(extensionsRoot)
    .filter((p) => p.packageName)
    .filter((p) => p.hasWatch);

  if (!packages.length) {
    console.log(
      'No extension packages found with a "watch" script under extensions/*.',
    );
    return;
  }

  console.log(`Starting watch for ${packages.length} extension(s):`);
  for (const pkg of packages) {
    console.log(`- ${pkg.packageName} (${pkg.folderName})`);
  }

  const children = new Map();
  let shuttingDown = false;
  let startedCount = 0;
  let exitedSuccessCount = 0;

  function shutdown(exitCode) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    for (const child of children.values()) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }

    if (typeof exitCode === "number") {
      process.exitCode = exitCode;
    }
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  for (const pkg of packages) {
    startedCount += 1;
    const child = spawn("yarn", ["workspace", pkg.packageName, "watch"], {
      cwd: repoRoot,
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    children.set(pkg.packageName, child);
    prefixStream(child.stdout, pkg.packageName);
    prefixStream(child.stderr, pkg.packageName);

    child.on("exit", (code, signal) => {
      children.delete(pkg.packageName);

      if (shuttingDown) {
        return;
      }

      if (signal) {
        console.error(`[${pkg.packageName}] exited with signal ${signal}`);
        shutdown(1);
        return;
      }

      if (code && code !== 0) {
        console.error(`[${pkg.packageName}] exited with code ${code}`);
        shutdown(code);
        return;
      }

      exitedSuccessCount += 1;
      console.log(`[${pkg.packageName}] exited`);

      // Only stop when all watchers have exited successfully.
      if (exitedSuccessCount >= startedCount) {
        shutdown(0);
      }
    });
  }
}

try {
  main();
} catch (error) {
  console.error(
    "Failed to start extension watchers:",
    error?.message ?? String(error),
  );
  process.exit(1);
}
