/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { sqlToolsMcpProviderId, sqlToolsMcpServerLabel } from "./contracts";
import { SqlToolsMcpBridgeManager } from "./sqlToolsMcpBridgeManager";
import { Logger } from "../models/logger";

const debugLaunchArg = "--vscode-mssql-debug-launch";

export class SqlToolsMcpServerDefinitionProvider
    implements
        vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>,
        vscode.Disposable
{
    private readonly didChangeEmitter = new vscode.EventEmitter<void>();

    readonly onDidChangeMcpServerDefinitions = this.didChangeEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly bridgeManager: SqlToolsMcpBridgeManager,
        private readonly logger: Logger,
        private readonly getSqlToolsServicePath: () => string | undefined,
    ) {}

    async provideMcpServerDefinitions(): Promise<vscode.McpStdioServerDefinition[]> {
        const executable = this.resolveBundledExecutable();
        if (!executable) {
            this.logger.warn("Bundled SQL Tools MCP server executable was not found.");
            return [];
        }

        return [this.createStdioDefinition(executable, undefined)];
    }

    async resolveMcpServerDefinition(): Promise<vscode.McpStdioServerDefinition | undefined> {
        const executable = this.resolveBundledExecutable();
        if (!executable) {
            throw new Error("Bundled SQL Tools MCP server executable was not found.");
        }

        const launchInfo = await this.bridgeManager.prepareLaunch();
        return this.createStdioDefinition(executable, launchInfo.endpoint);
    }

    dispose(): void {
        this.didChangeEmitter.dispose();
    }

    private createStdioDefinition(
        executable: BundledExecutable,
        bridgeEndpoint: string | undefined,
    ): vscode.McpStdioServerDefinition {
        const env: Record<string, string | number | null> = {
            SQLtools__ConnectionProvider: "vscode",
            SQLtools__CartridgeExperience: "MCP_VSCode",
            SQLtools__SkillContentProvider: "External",
            ...(bridgeEndpoint
                ? {
                      SQLtools__VsCodeBridgeEndpoint: bridgeEndpoint,
                  }
                : {}),
        };

        const definition = new vscode.McpStdioServerDefinition(
            sqlToolsMcpServerLabel,
            executable.command,
            this.getLaunchArgs(),
            env,
            this.packageVersion,
        );
        definition.cwd = vscode.Uri.file(executable.cwd);
        return definition;
    }

    private getLaunchArgs(): string[] {
        if (this.context.extensionMode !== vscode.ExtensionMode.Development) {
            return [];
        }

        return [debugLaunchArg];
    }

    private resolveBundledExecutable(): BundledExecutable | undefined {
        const executableName =
            process.platform === "win32" ? "SQLtoolsMCPserver.exe" : "SQLtoolsMCPserver";
        const platformKey = this.getPlatformKey();
        const sqlToolsServicePath = this.getSqlToolsServicePath();
        const legacyCompatibilityCandidates = sqlToolsServicePath
            ? [
                  path.join(sqlToolsServicePath, "scriptoria-mcp", executableName),
                  path.join(sqlToolsServicePath, "mcp", "SqlScriptoria", executableName),
              ]
            : [];
        const candidates = [
            ...(sqlToolsServicePath
                ? [
                      path.join(sqlToolsServicePath, executableName),
                      path.join(sqlToolsServicePath, "sqltools-mcp", executableName),
                      path.join(sqlToolsServicePath, "mcp", "SqlToolsMcp", executableName),
                  ]
                : []),
            this.context.asAbsolutePath(path.join("sqltools-mcp", platformKey, executableName)),
            this.context.asAbsolutePath(
                path.join("resources", "sqltools-mcp", platformKey, executableName),
            ),
            this.context.asAbsolutePath(
                path.join("mcp", "SqlToolsMcp", platformKey, executableName),
            ),
            // Temporary compatibility fallbacks for older package layouts.
            ...legacyCompatibilityCandidates,
            this.context.asAbsolutePath(path.join("scriptoria-mcp", platformKey, executableName)),
            this.context.asAbsolutePath(
                path.join("resources", "scriptoria-mcp", platformKey, executableName),
            ),
            this.context.asAbsolutePath(
                path.join("mcp", "SqlScriptoria", platformKey, executableName),
            ),
            path.join(getSqlCopilotDevPublishPath(), executableName),
        ];

        const command = candidates.find((candidate) => fs.existsSync(candidate));
        return command
            ? {
                  command,
                  cwd: path.dirname(command),
              }
            : undefined;
    }

    private getPlatformKey(): string {
        const arch = process.arch === "arm64" ? "arm64" : "x64";
        switch (process.platform) {
            case "win32":
                return `win-${arch}`;
            case "darwin":
                return `osx-${arch}`;
            default:
                return `linux-${arch}`;
        }
    }

    private get packageVersion(): string | undefined {
        return (
            this.context as vscode.ExtensionContext & {
                extension?: { packageJSON?: { version?: string } };
            }
        ).extension?.packageJSON?.version;
    }
}

interface BundledExecutable {
    command: string;
    cwd: string;
}

export function canRegisterSqlToolsMcpProvider(): boolean {
    return (
        typeof vscode.lm?.registerMcpServerDefinitionProvider === "function" &&
        typeof vscode.McpStdioServerDefinition === "function"
    );
}

export function registerProvider(provider: SqlToolsMcpServerDefinitionProvider): vscode.Disposable {
    return vscode.lm.registerMcpServerDefinitionProvider(sqlToolsMcpProviderId, provider);
}

function getSqlCopilotDevPublishPath(): string {
    return path.join(
        "/Users",
        "hacao",
        "Repos",
        "SqlCopilot",
        "out",
        "Release",
        "net10.0",
        "osx-arm64",
        "publish",
    );
}
