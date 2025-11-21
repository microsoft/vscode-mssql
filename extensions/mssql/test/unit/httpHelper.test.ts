/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { HttpHelper } from "../../src/http/httpHelper";
import { Logger } from "../../src/models/logger";

chai.use(sinonChai);

suite("HttpHelper tests", () => {
    let sandbox: sinon.SinonSandbox;
    let httpHelper: HttpHelper;

    setup(() => {
        sandbox = sinon.createSandbox();

        const logger = sandbox.createStubInstance(Logger);
        httpHelper = new HttpHelper(logger);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Proxy validation tests", () => {
        const envProxy = "env-proxy";
        const configProxy = "config-proxy";

        test("warns when proxy lacks protocol", async () => {
            const invalidProxyValue = "localhost:1234";

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(invalidProxyValue);

            sandbox
                .stub(vscode.Uri, "parse")
                .withArgs(invalidProxyValue)
                .returns({ scheme: undefined } as vscode.Uri);

            const warningMessageStub = sandbox
                .stub(vscode.window, "showWarningMessage")
                .resolves(undefined);

            await httpHelper.warnOnInvalidProxySettings();

            expect(warningMessageStub).to.have.been.calledOnceWithExactly(
                LocalizedConstants.Proxy.missingProtocolWarning(invalidProxyValue),
            );
        });

        test("warns when proxy parsing throws", async () => {
            const invalidProxyValue = "env-proxy.example";

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(invalidProxyValue);

            const uriError = new Error("invalid uri format");
            sandbox.stub(vscode.Uri, "parse").withArgs(invalidProxyValue).throws(uriError);

            const warningMessageStub = sandbox
                .stub(vscode.window, "showWarningMessage")
                .resolves(undefined);

            await httpHelper.warnOnInvalidProxySettings();

            expect(warningMessageStub).to.have.been.calledOnceWithExactly(
                LocalizedConstants.Proxy.unparseableWarning(invalidProxyValue, uriError.message),
            );
        });

        test("loadProxyConfig prefers VS Code configuration over environment variables", () => {
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxy: configProxy } as unknown as vscode.WorkspaceConfiguration);

            sandbox.stub(process, "env").value({
                HTTP_PROXY: envProxy,
                https_proxy: envProxy,
            });

            const proxy = httpHelper["loadProxyConfig"]();

            expect(proxy).to.equal(configProxy);
        });

        test("loadProxyConfig falls back to environment variables when config missing", () => {
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxy: undefined } as unknown as vscode.WorkspaceConfiguration);

            sandbox.stub(process, "env").value({
                HTTP_PROXY: envProxy,
            });

            const proxy = httpHelper["loadProxyConfig"]();

            expect(proxy).to.equal(envProxy);
        });
    });
});
