export const workspaceTargets = [
    {
        target: "extension-toolkit",
        kind: "package",
        aliases: ["extension-toolkit", "toolkit"],
        packageName: "extension-toolkit",
        directory: "packages/extension-toolkit",
        scripts: ["build", "watch", "test", "lint"],
    },
    {
        target: "sql-feature",
        kind: "package",
        aliases: ["sql-feature"],
        packageName: "sql-feature",
        directory: "packages/sql-feature",
        scripts: ["build", "watch", "test", "lint"],
    },
    {
        target: "mssql",
        kind: "extension",
        aliases: ["mssql"],
        packageName: "mssql",
        directory: "extensions/mssql",
        scripts: ["build", "watch", "test", "smoketest", "lint", "package"],
        supportsProdBuild: true,
        dependencies: {
            build: ["extension-toolkit", "sql-feature"],
            watch: ["extension-toolkit", "sql-feature"],
            lint: ["extension-toolkit", "sql-feature"],
        },
    },
    {
        target: "sql-database-projects",
        kind: "extension",
        aliases: ["sql-database-projects", "sqlproj"],
        packageName: "sql-database-projects-vscode",
        directory: "extensions/sql-database-projects",
        scripts: ["build", "watch", "lint", "package"],
    },
    {
        target: "data-workspace",
        kind: "extension",
        aliases: ["data-workspace", "dataworkspace"],
        packageName: "data-workspace-vscode",
        directory: "extensions/data-workspace",
        scripts: ["build", "watch", "lint", "package"],
    },
    {
        target: "database-management-keymap",
        kind: "extension",
        aliases: ["database-management-keymap", "keymap"],
        packageName: "mssql-database-management-keymap",
        directory: "extensions/database-management-keymap",
        scripts: ["package"],
    },
];

export const supportedActions = ["build", "watch", "test", "smoketest", "lint", "package"];
