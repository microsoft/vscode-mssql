export const workspaceTargets = [
    {
        target: "vscode-extensions-common",
        aliases: ["extensions-common", "common"],
        packageName: "@microsoft/vscode-extensions-common",
        directory: "packages/vscode-extensions-common",
        scripts: ["build", "watch", "lint"],
    },
    {
        target: "mssql",
        aliases: ["mssql"],
        packageName: "mssql",
        directory: "extensions/mssql",
        scripts: ["build", "watch", "test", "smoketest", "lint", "package"],
        supportsProdBuild: true,
    },
    {
        target: "sql-database-projects",
        aliases: ["sql-database-projects", "sqlproj"],
        packageName: "sql-database-projects-vscode",
        directory: "extensions/sql-database-projects",
        scripts: ["build", "watch", "test", "lint", "package"],
    },
    {
        target: "data-workspace",
        aliases: ["data-workspace", "dataworkspace"],
        packageName: "data-workspace-vscode",
        directory: "extensions/data-workspace",
        scripts: ["build", "watch", "test", "lint", "package"],
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
