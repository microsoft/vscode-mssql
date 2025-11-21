#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");

const SKIP_PATTERNS = [/^\.husky\//];

function shouldSkip(file) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(file));
}

function getFiles(targetAll) {
  const command = targetAll
    ? "git ls-files -z"
    : "git diff --cached --name-only --diff-filter=ACM -z";
  const output = execSync(command, { encoding: "buffer" });
  return output
    .toString("utf8")
    .split("\0")
    .map((f) => f.trim())
    .filter(Boolean);
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function convertFile(file) {
  if (shouldSkip(file)) {
    return false;
  }
  const buffer = fs.readFileSync(file);
  if (isBinary(buffer)) {
    return false;
  }

  const original = buffer.toString("utf8");
  const normalized = original.replace(/\r?\n/g, "\n");
  const crlfContent = normalized.replace(/\n/g, "\r\n");

  if (crlfContent === original) {
    return false;
  }

  fs.writeFileSync(file, crlfContent, "utf8");
  return true;
}

function stageFiles(files) {
  if (!files.length) {
    return;
  }

  execSync(
    "git add -- " + files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" "),
    { stdio: "inherit" },
  );
}

function main() {
  const runAll = process.argv.includes("--all");
  const files = getFiles(runAll);
  if (!files.length) {
    return;
  }

  const updated = files.filter(convertFile);
  if (updated.length) {
    if (runAll) {
      console.log(`Converted ${updated.length} file(s) to CRLF.`);
    } else {
      stageFiles(updated);
      console.log(
        `Converted ${updated.length} file(s) to CRLF and re-staged them.`,
      );
    }
  }
}

try {
  main();
} catch (error) {
  console.error("Failed to enforce CRLF line endings:", error.message);
  process.exit(1);
}
