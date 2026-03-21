export const workspaceTargets = [
    {
        target: "mssql",
        aliases: ["mssql"],
        workspace: "mssql",
        scripts: ["build", "watch", "test", "smoketest", "lint", "package"],
        supportsProdBuild: true,
    },
    {
        target: "sql-database-projects",
        aliases: ["sql-database-projects", "sqlproj"],
        workspace: "sql-database-projects-vscode",
        scripts: ["build", "watch", "test", "lint", "package"],
    },
    {
        target: "data-workspace",
        aliases: ["data-workspace", "dataworkspace"],
        workspace: "data-workspace-vscode",
        scripts: ["build", "watch", "test", "lint", "package"],
    },
    {
        target: "database-management-keymap",
        aliases: ["database-management-keymap", "keymap"],
        workspace: "mssql-database-management-keymap",
        scripts: ["package"],
    },
];

export const supportedActions = ["build", "watch", "test", "smoketest", "lint", "package"];
