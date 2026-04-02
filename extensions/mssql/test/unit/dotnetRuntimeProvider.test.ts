/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as vscode from "vscode";
import DotnetRuntimeProvider from "../../src/languageservice/dotnetRuntimeProvider";
import * as Constants from "../../src/constants/constants";
import { config } from "../../src/configurations/config";
import { ILogger } from "../../src/models/interfaces";
import { ServiceClient } from "../../src/constants/locConstants";

chai.use(sinonChai);

suite("DotnetRuntimeProvider tests", () => {
    let sandbox: sinon.SinonSandbox;
    let logger: sinon.SinonStubbedInstance<ILogger>;
    let executeCommandStub: sinon.SinonStub;
    let getExtensionStub: sinon.SinonStub;
    let activateExtensionStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        logger = {
            logDebug: sandbox.stub(),
            verbose: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            piiSanitized: sandbox.stub(),
            increaseIndent: sandbox.stub(),
            decreaseIndent: sandbox.stub(),
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
        };
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
            const result = await provider.acquireDotnetRuntime();

            expect(result).to.equal("/extension/dotnet");
            expect(executeCommandStub).to.have.been.calledWithExactly(
                Constants.dotnetAcquireCommand,
                {
                    version: config.service.dotnetRuntimeVersion,
                    requestingExtensionId: Constants.extensionId,
                },
            );
            expect(getExtensionStub).to.have.been.calledWith(Constants.dotnetRuntimeExtensionId);
            expect(activateExtensionStub).to.have.been.called;
            expect(logger.verbose).to.have.been.calledWithMatch("Acquired .NET runtime via");
        });

        test("should fall through when the runtime extension returns no path", async () => {
            executeCommandStub.resolves(undefined);
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();

            try {
                await provider.acquireDotnetRuntime();
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });

        test("should fall through when the runtime extension throws", async () => {
            executeCommandStub.rejects(new Error("Extension not available"));
            showErrorMessageStub.resolves(undefined);

            const provider = createProvider();

            try {
                await provider.acquireDotnetRuntime();
                expect.fail("Expected acquireDotnetRuntime to throw");
            } catch (err) {
                expect(logger.error).to.have.been.calledWithMatch("Error acquiring .NET runtime");
                expect((err as Error).message).to.equal(ServiceClient.runtimeNotFoundError);
            }
        });
    });
});
