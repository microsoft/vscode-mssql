export const workspaceTargets = [
    {
        target: "tsql-language-service",
        kind: "package",
        aliases: ["tsql-language-service", "tsql-ls"],
        packageName: "@vscode-mssql/tsql-language-service",
        directory: "packages/tsql-language-service",
        scripts: ["build", "watch", "test", "lint"],
    },
    {
        target: "extension-toolkit",
        kind: "package",
        aliases: ["extension-toolkit", "toolkit"],
        packageName: "extension-toolkit",
        directory: "packages/extension-toolkit",
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
            build: ["extension-toolkit", "tsql-language-service"],
            watch: ["extension-toolkit", "tsql-language-service"],
            lint: ["extension-toolkit", "tsql-language-service"],
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
