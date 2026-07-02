export const workspaceTargets = [
    {
        target: "extension-toolkit",
        aliases: ["extension-toolkit", "toolkit"],
        packageName: "extension-toolkit",
        directory: "packages/extension-toolkit",
        scripts: ["build", "watch", "lint"],
    },
    {
        target: "mssql",
        aliases: ["mssql"],
        packageName: "mssql",
        directory: "extensions/mssql",
        scripts: ["build", "watch", "test", "smoketest", "lint", "package"],
        supportsProdBuild: true,
        dependencies: {
            build: ["extension-toolkit"],
            watch: ["extension-toolkit"],
            lint: ["extension-toolkit"],
        },
    },
    {
        target: "sql-database-projects",
        aliases: ["sql-database-projects", "sqlproj"],
        packageName: "sql-database-projects-vscode",
        directory: "extensions/sql-database-projects",
        scripts: ["build", "watch", "test", "lint", "package"],
        dependencies: {
            build: ["extension-toolkit"],
            watch: ["extension-toolkit"],
            lint: ["extension-toolkit"],
        },
    },
    {
        target: "data-workspace",
        aliases: ["data-workspace", "dataworkspace"],
        packageName: "data-workspace-vscode",
        directory: "extensions/data-workspace",
        scripts: ["build", "watch", "test", "lint", "package"],
        dependencies: {
            build: ["extension-toolkit"],
            watch: ["extension-toolkit"],
            lint: ["extension-toolkit"],
        },
    },
    {
        target: "database-management-keymap",
        aliases: ["database-management-keymap", "keymap"],
        packageName: "mssql-database-management-keymap",
        directory: "extensions/database-management-keymap",
        scripts: ["package"],
    },
];

export const supportedActions = ["build", "watch", "test", "smoketest", "lint", "package"];
