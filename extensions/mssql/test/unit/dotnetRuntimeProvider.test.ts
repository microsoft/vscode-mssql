/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import DotnetRuntimeProvider from "../../src/languageservice/dotnetRuntimeProvider";
import * as Constants from "../../src/constants/constants";
import { ILogger } from "../../src/models/logger";
import { ServiceClient } from "../../src/constants/locConstants";
import { stubILogger } from "./utils";

chai.use(sinonChai);

suite("DotnetRuntimeProvider tests", () => {
    let sandbox: sinon.SinonSandbox;
    let logger: sinon.SinonStubbedInstance<ILogger>;
    let executeCommandStub: sinon.SinonStub;
    let getExtensionStub: sinon.SinonStub;
    let activateExtensionStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let fsAccessStub: sinon.SinonStub;
    let fsReadFileStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        logger = stubILogger(sandbox);
        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");
        activateExtensionStub = sandbox.stub().resolves(undefined);
        getExtensionStub = sandbox
            .stub(vscode.extensions, "getExtension")
            .callsFake((extensionId: string) => {
                if (extensionId === Constants.dotnetRuntimeExtensionId) {
                    return {
                        activate: activateExtensionStub,
                    } as unknown as vscode.Extension<unknown>;
                }
                return undefined;
            });
        showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
        fsAccessStub = sandbox.stub(fs, "access").resolves();
        fsReadFileStub = sandbox.stub(fs, "readFile").resolves(
            JSON.stringify({
                runtimeOptions: {
                    framework: {
                        name: "Microsoft.NETCore.App",
                        version: "10.0.7",
                    },
                },
            }),
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    function createProvider(): DotnetRuntimeProvider {
        return new DotnetRuntimeProvider(logger);
    }

    suite("Priority 1: ms-dotnettools extension", () => {
        test("should return the dotnet path from the runtime extension", async () => {
            executeCommandStub.resolves({ dotnetPath: "/extension/dotnet" });

            const provider = createProvider();
            const result = await provider.acquireDotnetRuntime(
                "/extension/service.runtimeconfig.json",
            );

            expect(result).to.equal("/extension/dotnet");
            expect(executeCommandStub).to.have.been.calledWithExactly(
                Constants.dotnetAcquireCommand,
                {
                    version: "10.0.7",
                    requestingExtensionId: Constants.extensionId,
                    mode: "runtime",
                    forceUpdate: true,
                },
            );
            expect(fsAccessStub).to.have.been.calledWith("/extension/dotnet");
            expect(getExtensionStub).to.have.been.calledWith(Constants.dotnetRuntimeExtensionId);
            expect(activateExtensionStub).to.have.been.called;
            expect(logger.debug).to.have.been.calledWithMatch("Acquired .NET runtime via");
        });

        test("should request the runtime version from the provided runtimeconfig", async () => {
            executeCommandStub.resolves({ dotnetPath: "/extension/dotnet" });
            fsReadFileStub.resolves(
                JSON.stringify({
                    runtimeOptions: {
                        framework: {
                            name: "Microsoft.NETCore.App",
                            version: "10.0.7",
                        },
                    },
                }),
            );

            const provider = createProvider();
            const result = await provider.acquireDotnetRuntime(
                "/extension/sqltoolsservice/MicrosoftSqlToolsServiceLayer.runtimeconfig.json",
            );

            expect(result).to.equal("/extension/dotnet");
            expect(fsReadFileStub).to.have.been.calledWith(
                "/extension/sqltoolsservice/MicrosoftSqlToolsServiceLayer.runtimeconfig.json",
                "utf-8",
            );
            expect(executeCommandStub).to.have.been.calledWithExactly(
                Constants.dotnetAcquireCommand,
                {
                    version: "10.0.7",
                    requestingExtensionId: Constants.extensionId,
                    mode: "runtime",
                    forceUpdate: true,
                },
            );
        });

        test("should request aspnetcore mode when runtimeconfig uses ASP.NET Core framework", async () => {
            executeCommandStub.resolves({ dotnetPath: "/extension/dotnet" });
            fsReadFileStub.resolves(
                JSON.stringify({
                    runtimeOptions: {
                        frameworks: [
                            {
                                name: "Microsoft.NETCore.App",
                                version: "10.0.7",
                            },
                            {
                                name: "Microsoft.AspNetCore.App",
                                version: "10.0.8",
                            },
                        ],
                    },
                }),
            );

            const provider = createProvider();
            const result = await provider.acquireDotnetRuntime(
                "/extension/sqltools-mcp/SQLtoolsMCPserver.runtimeconfig.json",
            );

            expect(result).to.equal("/extension/dotnet");
            expect(executeCommandStub).to.have.been.calledWithExactly(
                Constants.dotnetAcquireCommand,
                {
                    version: "10.0.8",
                    requestingExtensionId: Constants.extensionId,
                    mode: "aspnetcore",
                    forceUpdate: true,
                },
            );
        });

        test("should request runtime mode when runtimeconfig uses plural .NET Core frameworks", async () => {
            executeCommandStub.resolves({ dotnetPath: "/extension/dotnet" });
            fsReadFileStub.resolves(
                JSON.stringify({
                    runtimeOptions: {
                        frameworks: [
                            {
                                name: "Microsoft.NETCore.App",
                                version: "10.0.9",
                            },
                        ],
                    },
                }),
            );

            const provider = createProvider();
            const result = await provider.acquireDotnetRuntime(
                "/extension/sqltools-mcp/SQLtoolsMCPserver.runtimeconfig.json",
            );

            expect(result).to.equal("/extension/dotnet");
            expect(executeCommandStub).to.have.been.calledWithExactly(
                Constants.dotnetAcquireCommand,
                {
                    version: "10.0.9",
                    requestingExtensionId: Constants.extensionId,
                    mode: "runtime",
                    forceUpdate: true,
                },
            );
        });

        test("should fall through when runtimeconfig does not contain a supported framework", async () => {
            fsReadFileStub.resolves(
                JSON.stringify({
                    runtimeOptions: {
                        frameworks: [
                            {
                                name: "Unsupported.Framework",
                                version: "1.0.0",
                            },
                        ],
                    },
                }),
            );
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();

            try {
                await provider.acquireDotnetRuntime(
                    "/extension/sqltools-mcp/SQLtoolsMCPserver.runtimeconfig.json",
                );
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect(executeCommandStub).not.to.have.been.called;
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });

        test("should fall through when runtimeconfig cannot be read", async () => {
            fsReadFileStub.rejects(new Error("ENOENT"));
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();
            try {
                await provider.acquireDotnetRuntime(
                    "/extension/sqltoolsservice/MicrosoftSqlToolsServiceLayer.runtimeconfig.json",
                );
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect(logger.error).to.have.been.calledWithMatch(
                    "Unable to read .NET runtime version",
                );
                expect(executeCommandStub).not.to.have.been.called;
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });

        test("should fall through when the runtime extension returns no path", async () => {
            executeCommandStub.resolves(undefined);
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();

            try {
                await provider.acquireDotnetRuntime("/extension/service.runtimeconfig.json");
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });

        test("should fall through when the runtime extension returns an invalid path", async () => {
            executeCommandStub.resolves({ dotnetPath: "/missing/dotnet" });
            fsAccessStub.rejects(new Error("ENOENT"));
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();

            try {
                await provider.acquireDotnetRuntime("/extension/service.runtimeconfig.json");
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect(logger.error).to.have.been.calledWithMatch("Error acquiring .NET runtime");
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });

        test("should fall through when the runtime extension throws", async () => {
            executeCommandStub.rejects(new Error("Extension not available"));
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();

            try {
                await provider.acquireDotnetRuntime("/extension/service.runtimeconfig.json");
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect(logger.error).to.have.been.calledWithMatch("Error acquiring .NET runtime");
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });
    });
});
