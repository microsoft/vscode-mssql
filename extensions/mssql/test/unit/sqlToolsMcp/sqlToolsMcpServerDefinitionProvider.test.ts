/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { config } from "../../../src/configurations/config";
import DotnetRuntimeProvider from "../../../src/languageservice/dotnetRuntimeProvider";
import { Logger } from "../../../src/models/logger";
import { sqlToolsMcpProviderId } from "../../../src/sqlToolsMcp/contracts";
import {
    canRegisterSqlToolsMcpProvider,
    enableSqlToolsMcpConfigKey,
    registerProvider,
    sqlToolsMcpServerLabel,
    SqlToolsMcpServerDefinitionProvider,
} from "../../../src/sqlToolsMcp/sqlToolsMcpServerDefinitionProvider";
import { SqlToolsMcpBridgeManager } from "../../../src/sqlToolsMcp/sqlToolsMcpBridgeManager";
import { stubTelemetry } from "../utils";

chai.use(sinonChai);

suite("SQL Tools MCP server definition provider", () => {
    const extensionRoot = "/extension";
    const mcpVersion = config.sqlToolsMcp.version;
    let sandbox: sinon.SinonSandbox;
    let enabled: boolean;
    let existingPaths: Set<string>;
    let bridgeManager: sinon.SinonStubbedInstance<SqlToolsMcpBridgeManager>;
    let logger: sinon.SinonStubbedInstance<Logger>;
    let dotnetRuntimeProvider: sinon.SinonStubbedInstance<DotnetRuntimeProvider>;
    let showInformationMessageStub: sinon.SinonStub;
    let configListener: ((event: vscode.ConfigurationChangeEvent) => void) | undefined;
    let originalOverride: string | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        enabled = true;
        existingPaths = new Set();
        originalOverride = process.env.MSSQL_SQLTOOLS_MCP;
        delete process.env.MSSQL_SQLTOOLS_MCP;

        bridgeManager = sandbox.createStubInstance(SqlToolsMcpBridgeManager);
        bridgeManager.prepareLaunch.resolves({
            endpoint: "/tmp/sqltools-mcp/bridge.sock",
            generation: 1,
        });
        logger = sandbox.createStubInstance(Logger);
        dotnetRuntimeProvider = sandbox.createStubInstance(DotnetRuntimeProvider);
        dotnetRuntimeProvider.acquireDotnetRuntime.resolves("/dotnet/dotnet");
        stubTelemetry(sandbox);

        sandbox
            .stub(fs, "existsSync")
            .callsFake((candidate) => existingPaths.has(String(candidate)));
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().callsFake((key: string, defaultValue: unknown) => {
                if (key === enableSqlToolsMcpConfigKey) {
                    return enabled;
                }
                return defaultValue;
            }),
        } as unknown as vscode.WorkspaceConfiguration);
        sandbox.stub(vscode.workspace, "onDidChangeConfiguration").callsFake((listener) => {
            configListener = listener;
            return new vscode.Disposable(() => {});
        });
        showInformationMessageStub = sandbox
            .stub(vscode.window, "showInformationMessage")
            .resolves(undefined);
    });

    teardown(() => {
        if (originalOverride === undefined) {
            delete process.env.MSSQL_SQLTOOLS_MCP;
        } else {
            process.env.MSSQL_SQLTOOLS_MCP = originalOverride;
        }
        sandbox.restore();
    });

    test("does not provide definitions while the feature flag is disabled", async () => {
        enabled = false;
        const provider = createProvider();

        const provided = await provider.provideMcpServerDefinitions();
        const resolved = await provider.resolveMcpServerDefinition();

        expect(provided).to.deep.equal([]);
        expect(resolved).to.equal(undefined);
        expect(dotnetRuntimeProvider.acquireDotnetRuntime).not.to.have.been.called;
        expect(bridgeManager.prepareLaunch).not.to.have.been.called;
    });

    test("does not advertise the server when no bundled payload is available", async () => {
        const provider = createProvider();

        const definitions = await provider.provideMcpServerDefinitions();

        expect(definitions).to.deep.equal([]);
        expect(logger.warn).to.have.been.calledWith(
            "Bundled SQL Tools MCP server was not found or is not ready.",
        );
        expect(dotnetRuntimeProvider.acquireDotnetRuntime).not.to.have.been.called;
    });

    test("waits for portable dotnet acquisition before advertising the server", async () => {
        addBundledPortableDll();
        const provider = createProvider();

        const beforeInitialize = await provider.provideMcpServerDefinitions();
        await provider.initialize();
        const afterInitialize = await provider.provideMcpServerDefinitions();

        expect(beforeInitialize).to.deep.equal([]);
        expect(dotnetRuntimeProvider.acquireDotnetRuntime).to.have.been.calledWith(
            path.join(
                extensionRoot,
                "sqltools-mcp",
                mcpVersion,
                "Portable",
                "SQLtoolsMCPserver.runtimeconfig.json",
            ),
        );
        expect(afterInitialize).to.have.length(1);
        expect(afterInitialize[0].label).to.equal(sqlToolsMcpServerLabel);
        expect(afterInitialize[0].command).to.equal("/dotnet/dotnet");
        expect(afterInitialize[0].args).to.deep.equal([
            path.join(
                extensionRoot,
                "sqltools-mcp",
                mcpVersion,
                "Portable",
                "SQLtoolsMCPserver.dll",
            ),
        ]);
        expect(afterInitialize[0].env.SQLtools__VsCodeBridgeEndpoint).to.equal(undefined);
    });

    test("prepares a per-launch bridge endpoint when resolving the server", async () => {
        addBundledPortableDll();
        const provider = createProvider(vscode.ExtensionMode.Development);
        await provider.initialize();

        const definition = await provider.resolveMcpServerDefinition();

        expect(bridgeManager.prepareLaunch).to.have.been.called;
        expect(definition?.command).to.equal("/dotnet/dotnet");
        expect(definition?.args).to.deep.equal([
            path.join(
                extensionRoot,
                "sqltools-mcp",
                mcpVersion,
                "Portable",
                "SQLtoolsMCPserver.dll",
            ),
            "--vscode-mssql-debug-launch",
        ]);
        expect(definition?.env).to.deep.include({
            SQLtools__ConnectionProvider: "vscode",
            SQLtools__CartridgeExperience: "MCP_VSCode",
            SQLtools__SkillContentProvider: "External",
            SQLtools__ExecutionMode: "READ_WRITE",
            SQLtools__VsCodeBridgeEndpoint: "/tmp/sqltools-mcp/bridge.sock",
        });
        expect(definition?.cwd?.fsPath).to.equal(
            path.join(extensionRoot, "sqltools-mcp", mcpVersion, "Portable"),
        );
        expect(definition?.version).to.equal("1.2.3");
    });

    test("prefers bundled self-contained executable over portable payload", async () => {
        addBundledPortableDll();
        const executablePath = path.join(
            extensionRoot,
            "sqltools-mcp",
            mcpVersion,
            getPlatformKey(),
            getExecutableName(),
        );
        existingPaths.add(executablePath);
        const provider = createProvider();

        const definitions = await provider.provideMcpServerDefinitions();

        expect(definitions).to.have.length(1);
        expect(definitions[0].command).to.equal(executablePath);
        expect(definitions[0].args).to.deep.equal([]);
        expect(dotnetRuntimeProvider.acquireDotnetRuntime).not.to.have.been.called;
    });

    test("uses an override portable payload when MSSQL_SQLTOOLS_MCP is set", async () => {
        process.env.MSSQL_SQLTOOLS_MCP = "/override/sqltools-mcp";
        existingPaths.add(path.join("/override/sqltools-mcp", "SQLtoolsMCPserver.dll"));
        const provider = createProvider();

        await provider.initialize();
        const definitions = await provider.provideMcpServerDefinitions();

        expect(dotnetRuntimeProvider.acquireDotnetRuntime).to.have.been.calledWith(
            path.join("/override/sqltools-mcp", "SQLtoolsMCPserver.runtimeconfig.json"),
        );
        expect(definitions[0].command).to.equal("/dotnet/dotnet");
        expect(definitions[0].args).to.deep.equal([
            path.join("/override/sqltools-mcp", "SQLtoolsMCPserver.dll"),
        ]);
        expect(showInformationMessageStub).not.to.have.been.called;
    });

    test("notifies once when resolving a server from the override path", async () => {
        process.env.MSSQL_SQLTOOLS_MCP = "/override/sqltools-mcp";
        existingPaths.add(path.join("/override/sqltools-mcp", getExecutableName()));
        const provider = createProvider();

        await provider.resolveMcpServerDefinition();
        await provider.resolveMcpServerDefinition();

        expect(showInformationMessageStub).to.have.been.calledOnceWith(
            "Launched SQL Tools MCP server from overridden path: /override/sqltools-mcp",
        );
    });

    test("throws when the override path does not contain a launchable payload", async () => {
        process.env.MSSQL_SQLTOOLS_MCP = "/override/sqltools-mcp";
        const provider = createProvider();

        try {
            await provider.resolveMcpServerDefinition();
            expect.fail("Expected resolveMcpServerDefinition to throw");
        } catch (err) {
            expect((err as Error).message).to.contain(
                "SQL Tools MCP override path does not contain SQLtoolsMCPserver or SQLtoolsMCPserver.dll",
            );
        }

        expect(bridgeManager.prepareLaunch).not.to.have.been.called;
        expect(showInformationMessageStub).not.to.have.been.called;
    });

    test("notifies and initializes when the feature flag changes on", () => {
        enabled = false;
        const provider = createProvider();
        const initializeStub = sandbox.stub(provider, "initialize").resolves();
        const didChangeSpy = sandbox.spy();
        provider.onDidChangeMcpServerDefinitions(didChangeSpy);
        enabled = true;

        configListener?.({
            affectsConfiguration: (key: string) => key === enableSqlToolsMcpConfigKey,
        } as vscode.ConfigurationChangeEvent);

        expect(didChangeSpy).to.have.been.called;
        expect(initializeStub).to.have.been.called;
    });

    test("registers with the stable SQL Tools MCP provider id", () => {
        const registerStub = sandbox
            .stub(vscode.lm, "registerMcpServerDefinitionProvider")
            .returns(new vscode.Disposable(() => {}));
        const provider = createProvider();

        registerProvider(provider);

        expect(registerStub).to.have.been.calledWith(sqlToolsMcpProviderId, provider);
    });

    test("reports whether the VS Code MCP stdio provider API is available", () => {
        expect(canRegisterSqlToolsMcpProvider()).to.equal(
            typeof vscode.lm?.registerMcpServerDefinitionProvider === "function" &&
                typeof vscode.McpStdioServerDefinition === "function",
        );
    });

    function createProvider(
        extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Production,
    ): SqlToolsMcpServerDefinitionProvider {
        return new SqlToolsMcpServerDefinitionProvider(
            {
                asAbsolutePath: (relativePath: string) => path.join(extensionRoot, relativePath),
                extension: {
                    packageJSON: {
                        version: "1.2.3",
                    },
                },
                extensionMode,
            } as unknown as vscode.ExtensionContext,
            bridgeManager,
            logger,
            dotnetRuntimeProvider,
        );
    }

    function addBundledPortableDll(): void {
        existingPaths.add(
            path.join(
                extensionRoot,
                "sqltools-mcp",
                mcpVersion,
                "Portable",
                "SQLtoolsMCPserver.dll",
            ),
        );
    }
});

function getExecutableName(): string {
    return process.platform === "win32" ? "SQLtoolsMCPserver.exe" : "SQLtoolsMCPserver";
}

function getPlatformKey(): string {
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
