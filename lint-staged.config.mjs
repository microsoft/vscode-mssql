import path from "node:path";

const repoRoot = process.cwd();

function toAbsolute(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function toPosix(filePath) {
    return filePath.split(path.sep).join(path.posix.sep);
}

function toRepoRelative(files) {
    return files.map((f) => toPosix(path.relative(repoRoot, toAbsolute(f))));
}

function toWorkspaceRelative(workspaceDirFromRepoRoot, files) {
    const workspaceAbs = path.join(repoRoot, workspaceDirFromRepoRoot);
    return files.map((f) => toPosix(path.relative(workspaceAbs, toAbsolute(f))));
}

function shQuote(arg) {
    // POSIX-safe single-quote escaping
    return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

function joinQuoted(args) {
    return args.map(shQuote).join(" ");
}

function eslintInWorkspace(workspaceDirFromRepoRoot, eslintArgs, files) {
    const relFiles = toWorkspaceRelative(workspaceDirFromRepoRoot, files);
    return `cd ${shQuote(workspaceDirFromRepoRoot)} && yarn -s eslint ${eslintArgs} ${joinQuoted(relFiles)}`;
}

function prettierFromRoot(prettierArgs, files) {
    const repoRelFiles = toRepoRelative(files);
    return `yarn -s prettier ${prettierArgs} ${joinQuoted(repoRelFiles)}`;
}

function excludeRepoPrefix(files, prefix) {
    const repoRelFiles = toRepoRelative(files);
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return repoRelFiles.filter((f) => !f.startsWith(normalizedPrefix));
}

export default {
    // Format non-TS assets repo-wide with root prettier config.
    "**/*.{js,mjs,json,yml,yaml,md,html,svg,css}": (files) => {
        const filtered = excludeRepoPrefix(files, "extensions/mssql");
        return filtered.length ? [prettierFromRoot("--write", filtered)] : [];
    },

    // mssql extension (has its own eslint + prettier configs)
    "extensions/mssql/**/*.{js,mjs,json,yml,yaml,md,html,svg,css}": (files) => [
        prettierFromRoot("--config extensions/mssql/prettier.config.mjs --write", files),
    ],
    "extensions/mssql/**/*.{ts,tsx}": (files) => [
        eslintInWorkspace("extensions/mssql", "--quiet --cache --fix", files),
        prettierFromRoot("--config extensions/mssql/prettier.config.mjs --write", files),
    ],

    // data-workspace extension
    "extensions/data-workspace/**/*.{ts,tsx}": (files) => [
        eslintInWorkspace("extensions/data-workspace", "--fix", files),
        prettierFromRoot("--write", files),
    ],

    // sql-database-projects extension
    "extensions/sql-database-projects/**/*.{ts,tsx}": (files) => [
        eslintInWorkspace("extensions/sql-database-projects", "--fix", files),
        prettierFromRoot("--write", files),
    ],
};
