/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { isSqlToolsMcpEnabled, enableSqlToolsMcpConfigKey } from "../copilot/sqlToolSurfaceToggle";
import { config } from "../configurations/config";
import DotnetRuntimeProvider from "../languageservice/dotnetRuntimeProvider";
import { getRuntimeConfigPath } from "../languageservice/serviceExecutablePaths";
import { sqlToolsMcpProviderId, sqlToolsMcpServerLabel } from "./contracts";
import { SqlToolsMcpBridgeManager } from "./sqlToolsMcpBridgeManager";
import { Logger } from "../models/logger";
import { TelemetryActions } from "../sharedInterfaces/telemetry";
import { getElapsedMs, sendSqlToolsMcpAction, sendSqlToolsMcpError } from "./sqlToolsMcpTelemetry";

const debugLaunchArg = "--vscode-mssql-debug-launch";
const sqlToolsMcpOverrideEnvVar = "MSSQL_SQLTOOLS_MCP";

export class SqlToolsMcpServerDefinitionProvider
    implements
        vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>,
        vscode.Disposable
{
    private readonly didChangeEmitter = new vscode.EventEmitter<void>();
    private readonly configChangeDisposable: vscode.Disposable;
    private readonly dotnetPathByRuntimeConfig = new Map<string, string>();

    readonly onDidChangeMcpServerDefinitions = this.didChangeEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly bridgeManager: SqlToolsMcpBridgeManager,
        private readonly logger: Logger,
        private readonly getSqlToolsServicePath: () => string | undefined,
        private readonly dotnetRuntimeProvider: DotnetRuntimeProvider,
    ) {
        this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration(enableSqlToolsMcpConfigKey)) {
                return;
            }

            this.didChangeEmitter.fire();
            if (isSqlToolsMcpEnabled()) {
                void this.initialize();
            }
        });
    }

    async initialize(): Promise<void> {
        if (!isSqlToolsMcpEnabled()) {
            return;
        }

        const startTime = performance.now();
        try {
            const launchTarget = await this.resolveBundledLaunchTarget({
                acquireDotnetRuntime: true,
            });
            sendSqlToolsMcpAction(
                TelemetryActions.SqlToolsMcpDefinitionResolution,
                {
                    phase: "initialize",
                    success: String(Boolean(launchTarget)),
                    launchKind: launchTarget?.kind ?? "none",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            this.didChangeEmitter.fire();
        } catch (err) {
            sendSqlToolsMcpError(
                TelemetryActions.SqlToolsMcpDefinitionResolution,
                err,
                {
                    phase: "initialize",
                    success: "false",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            this.logger.warn(`SQL Tools MCP runtime preparation failed: ${getErrorMessage(err)}`);
        }
    }

    async provideMcpServerDefinitions(): Promise<vscode.McpStdioServerDefinition[]> {
        if (!isSqlToolsMcpEnabled()) {
            return [];
        }

        const launchTarget = await this.resolveBundledLaunchTarget({ acquireDotnetRuntime: false });
        if (!launchTarget) {
            this.logger.warn("Bundled SQL Tools MCP server was not found or is not ready.");
            return [];
        }

        return [this.createStdioDefinition(launchTarget, undefined)];
    }

    async resolveMcpServerDefinition(): Promise<vscode.McpStdioServerDefinition | undefined> {
        if (!isSqlToolsMcpEnabled()) {
            return undefined;
        }

        const startTime = performance.now();
        try {
            const launchTarget = await this.resolveBundledLaunchTarget({
                acquireDotnetRuntime: true,
            });
            if (!launchTarget) {
                throw new Error("Bundled SQL Tools MCP server was not found or is not ready.");
            }

            const launchInfo = await this.bridgeManager.prepareLaunch();
            sendSqlToolsMcpAction(
                TelemetryActions.SqlToolsMcpDefinitionResolution,
                {
                    phase: "resolve",
                    success: "true",
                    launchKind: launchTarget.kind,
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            return this.createStdioDefinition(launchTarget, launchInfo.endpoint);
        } catch (err) {
            sendSqlToolsMcpError(
                TelemetryActions.SqlToolsMcpDefinitionResolution,
                err,
                {
                    phase: "resolve",
                    success: "false",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            throw err;
        }
    }

    dispose(): void {
        this.configChangeDisposable.dispose();
        this.didChangeEmitter.dispose();
    }

    private createStdioDefinition(
        launchTarget: McpLaunchTarget,
        bridgeEndpoint: string | undefined,
    ): vscode.McpStdioServerDefinition {
        const env: Record<string, string | number | null> = {
            SQLtools__ConnectionProvider: "vscode",
            SQLtools__CartridgeExperience: "MCP_VSCode",
            SQLtools__SkillContentProvider: "External",
            SQLtools__ExecutionMode: "READ_WRITE",
            ...(bridgeEndpoint
                ? {
                      SQLtools__VsCodeBridgeEndpoint: bridgeEndpoint,
                  }
                : {}),
        };

        const definition = new vscode.McpStdioServerDefinition(
            sqlToolsMcpServerLabel,
            launchTarget.command,
            [...launchTarget.args, ...this.getLaunchArgs()],
            env,
            this.packageVersion,
        );
        definition.cwd = vscode.Uri.file(launchTarget.cwd);
        return definition;
    }

    private getLaunchArgs(): string[] {
        if (this.context.extensionMode !== vscode.ExtensionMode.Development) {
            return [];
        }

        return [debugLaunchArg];
    }

    private async resolveBundledLaunchTarget(options: {
        acquireDotnetRuntime: boolean;
    }): Promise<McpLaunchTarget | undefined> {
        if (process.env[sqlToolsMcpOverrideEnvVar]) {
            return await this.resolveOverrideLaunchTarget(options);
        }

        const selfContainedExecutable = this.resolveBundledSelfContainedExecutable();
        if (selfContainedExecutable) {
            return {
                command: selfContainedExecutable,
                args: [],
                cwd: path.dirname(selfContainedExecutable),
                kind: "selfContained",
            };
        }

        const portableDll = this.resolveBundledPortableDll();
        if (!portableDll) {
            return undefined;
        }

        return await this.createPortableLaunchTarget(portableDll, options);
    }

    private async resolveOverrideLaunchTarget(options: {
        acquireDotnetRuntime: boolean;
    }): Promise<McpLaunchTarget | undefined> {
        const overrideFolder = process.env[sqlToolsMcpOverrideEnvVar];
        if (!overrideFolder) {
            return undefined;
        }

        const selfContainedExecutable = this.resolveSelfContainedExecutableInFolder(overrideFolder);
        if (selfContainedExecutable) {
            return {
                command: selfContainedExecutable,
                args: [],
                cwd: path.dirname(selfContainedExecutable),
                kind: "selfContained",
            };
        }

        const portableDll = this.resolvePortableDllInFolder(overrideFolder);
        if (portableDll) {
            return await this.createPortableLaunchTarget(portableDll, options);
        }

        throw new Error(
            `SQL Tools MCP override path does not contain SQLtoolsMCPserver or SQLtoolsMCPserver.dll: ${overrideFolder}`,
        );
    }

    private async createPortableLaunchTarget(
        portableDll: string,
        options: { acquireDotnetRuntime: boolean },
    ): Promise<McpLaunchTarget | undefined> {
        const runtimeConfigPath = getRuntimeConfigPath(portableDll);
        const cachedDotnetPath = this.dotnetPathByRuntimeConfig.get(runtimeConfigPath);
        if (!options.acquireDotnetRuntime && !cachedDotnetPath) {
            return undefined;
        }

        const dotnetPath =
            cachedDotnetPath ??
            (await this.dotnetRuntimeProvider.acquireDotnetRuntime(runtimeConfigPath));
        this.dotnetPathByRuntimeConfig.set(runtimeConfigPath, dotnetPath);

        return {
            command: dotnetPath,
            args: [portableDll],
            cwd: path.dirname(portableDll),
            kind: "portable",
        };
    }

    private resolveBundledSelfContainedExecutable(): string | undefined {
        const platformKey = this.getPlatformKey();
        const sqlToolsServicePath = this.getSqlToolsServicePath();
        const legacyCompatibilityCandidates = sqlToolsServicePath
            ? [
                  path.join(
                      sqlToolsServicePath,
                      "scriptoria-mcp",
                      getSelfContainedExecutableName(),
                  ),
                  path.join(
                      sqlToolsServicePath,
                      "mcp",
                      "SqlScriptoria",
                      getSelfContainedExecutableName(),
                  ),
              ]
            : [];
        const candidates = [
            this.context.asAbsolutePath(
                path.join(
                    "sqltools-mcp",
                    config.sqlToolsMcp.version,
                    platformKey,
                    getSelfContainedExecutableName(),
                ),
            ),
            ...(sqlToolsServicePath
                ? [
                      path.join(sqlToolsServicePath, getSelfContainedExecutableName()),
                      path.join(
                          sqlToolsServicePath,
                          "sqltools-mcp",
                          getSelfContainedExecutableName(),
                      ),
                      path.join(
                          sqlToolsServicePath,
                          "mcp",
                          "SqlToolsMcp",
                          getSelfContainedExecutableName(),
                      ),
                  ]
                : []),
            this.context.asAbsolutePath(
                path.join("sqltools-mcp", platformKey, getSelfContainedExecutableName()),
            ),
            this.context.asAbsolutePath(
                path.join(
                    "resources",
                    "sqltools-mcp",
                    platformKey,
                    getSelfContainedExecutableName(),
                ),
            ),
            this.context.asAbsolutePath(
                path.join("mcp", "SqlToolsMcp", platformKey, getSelfContainedExecutableName()),
            ),
            // Temporary compatibility fallbacks for older package layouts.
            ...legacyCompatibilityCandidates,
            this.context.asAbsolutePath(
                path.join("scriptoria-mcp", platformKey, getSelfContainedExecutableName()),
            ),
            this.context.asAbsolutePath(
                path.join(
                    "resources",
                    "scriptoria-mcp",
                    platformKey,
                    getSelfContainedExecutableName(),
                ),
            ),
            this.context.asAbsolutePath(
                path.join("mcp", "SqlScriptoria", platformKey, getSelfContainedExecutableName()),
            ),
        ];

        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    private resolveBundledPortableDll(): string | undefined {
        const candidates = [
            this.context.asAbsolutePath(
                path.join(
                    "sqltools-mcp",
                    config.sqlToolsMcp.version,
                    "Portable",
                    "SQLtoolsMCPserver.dll",
                ),
            ),
            this.context.asAbsolutePath(
                path.join("sqltools-mcp", "Portable", "SQLtoolsMCPserver.dll"),
            ),
            this.context.asAbsolutePath(
                path.join("resources", "sqltools-mcp", "Portable", "SQLtoolsMCPserver.dll"),
            ),
            this.context.asAbsolutePath(
                path.join("mcp", "SqlToolsMcp", "Portable", "SQLtoolsMCPserver.dll"),
            ),
        ];

        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    private resolveSelfContainedExecutableInFolder(folder: string): string | undefined {
        const executablePath = path.join(folder, getSelfContainedExecutableName());
        return fs.existsSync(executablePath) ? executablePath : undefined;
    }

    private resolvePortableDllInFolder(folder: string): string | undefined {
        const portableDllPath = path.join(folder, "SQLtoolsMCPserver.dll");
        return fs.existsSync(portableDllPath) ? portableDllPath : undefined;
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

interface McpLaunchTarget {
    command: string;
    args: string[];
    cwd: string;
    kind: "portable" | "selfContained";
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

function getSelfContainedExecutableName(): string {
    return process.platform === "win32" ? "SQLtoolsMCPserver.exe" : "SQLtoolsMCPserver";
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
