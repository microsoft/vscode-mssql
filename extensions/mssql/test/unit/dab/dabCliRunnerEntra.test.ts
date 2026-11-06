/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import {
    DabAzureCli,
    DabAzureCliInstallError,
    DabAzureCliResolution,
    DabAzureCliSignIn,
} from "../../../src/dab/dabAzureCli";
import { DabCliRunner, pythonDownloadLink } from "../../../src/dab/dabCliRunner";
import { Logger } from "../../../src/models/logger";
import { Dab } from "../../../src/sharedInterfaces/dab";

chai.use(sinonChai);

suite("DabCliRunner Microsoft Entra steps", () => {
    let sandbox: sinon.SinonSandbox;
    let azureCli: sinon.SinonStubbedInstance<DabAzureCli>;
    let runner: DabCliRunner;

    const resolution: DabAzureCliResolution = {
        azPath: "az",
        environment: { AZURE_CONFIG_DIR: "config", AZURE_TOKEN_CREDENTIALS: "AzureCliCredential" },
    };
    const entra = { tenantId: "contoso.onmicrosoft.com", account: "user@contoso.com" };

    function createSignIn(
        completion: { success: boolean; error?: string },
        deviceCode?: { userCode: string; verificationUri: string },
    ): DabAzureCliSignIn & { cancel: sinon.SinonStub } {
        return {
            deviceCode: deviceCode ? Promise.resolve(deviceCode) : undefined,
            completion: Promise.resolve(completion),
            cancel: sandbox.stub(),
        };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        azureCli = sandbox.createStubInstance(DabAzureCli);
        const logger = sandbox.createStubInstance(Logger);
        runner = new DabCliRunner("storage", logger, azureCli as unknown as DabAzureCli);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("installs the private Azure CLI and reports its progress", async () => {
        const progress: Dab.DabDeploymentStepProgress[] = [];
        azureCli.install.callsFake(async (onProgress) => {
            onProgress?.({ phase: "download", completed: 10, total: 100 });
            onProgress?.({ phase: "pip" });
            return resolution;
        });

        const result = await runner.prepareAzureCli((update) => progress.push(update));

        expect(result.success).to.be.true;
        expect(result.detail).to.be.a("string").and.not.empty;
        expect(progress).to.deep.equal([
            { phase: "download", completed: 10, total: 100 },
            { phase: "install" },
        ]);
        expect(await runner.getAzureCliEnvironment()).to.deep.equal(resolution.environment);
    });

    test("points at a Python download when the private Azure CLI needs one", async () => {
        azureCli.install.rejects(new DabAzureCliInstallError("python", "no python"));

        const result = await runner.prepareAzureCli();

        expect(result.success).to.be.false;
        expect(result.errorLink).to.equal(pythonDownloadLink);
        expect(result.fullErrorText).to.equal("no python");
    });

    test("reuses an existing sign-in that can get a database token", async () => {
        azureCli.resolve.resolves(resolution);
        azureCli.getSignedInAccount.resolves({ account: "user@contoso.com" });

        const result = await runner.signInEntra(undefined, entra);

        expect(result.success).to.be.true;
        expect(result.detail).to.include("user@contoso.com");
        expect(azureCli.getSignedInAccount).to.have.been.calledWith(resolution, entra.tenantId);
        expect(azureCli.signIn).to.not.have.been.called;
    });

    test("waits for the user when there is no usable sign-in", async () => {
        azureCli.resolve.resolves(resolution);
        azureCli.getSignedInAccount.resolves(undefined);

        const result = await runner.signInEntra(undefined, entra);

        expect(result.success).to.be.false;
        expect(result.prompt).to.deep.equal({ kind: "entraSignIn", account: entra.account });
        expect(result.error).to.equal(undefined);
    });

    test("signs in through the browser for the connection's tenant", async () => {
        azureCli.resolve.resolves(resolution);
        azureCli.signIn.returns(createSignIn({ success: true }));
        azureCli.getSignedInAccount.resolves({ account: "user@contoso.com" });

        const result = await runner.signInEntra(Dab.DabDeploymentStepAction.SignIn, entra);

        expect(result.success).to.be.true;
        expect(azureCli.signIn).to.have.been.calledWith(resolution, { tenantId: entra.tenantId });
    });

    test("reports a sign-in that ended without a database token as a failure", async () => {
        azureCli.resolve.resolves(resolution);
        azureCli.signIn.returns(createSignIn({ success: false, error: "user cancelled" }));

        const result = await runner.signInEntra(Dab.DabDeploymentStepAction.SignIn, entra);

        expect(result.success).to.be.false;
        expect(result.prompt).to.equal(undefined);
        expect(result.fullErrorText).to.equal("user cancelled");
    });

    test("reports a device code, then finishes when the user enters it", async () => {
        const deviceCode = {
            userCode: "ABCD1234",
            verificationUri: "https://microsoft.com/devicelogin",
        };
        azureCli.resolve.resolves(resolution);
        azureCli.signIn.returns(createSignIn({ success: true }, deviceCode));
        azureCli.getSignedInAccount.resolves({ account: "user@contoso.com" });

        const started = await runner.signInEntra(Dab.DabDeploymentStepAction.SignInWithCode, entra);
        const finished = await runner.signInEntra(Dab.DabDeploymentStepAction.AwaitSignIn, entra);

        expect(started.prompt).to.deep.equal({
            kind: "entraDeviceCode",
            account: entra.account,
            ...deviceCode,
        });
        expect(azureCli.signIn).to.have.been.calledWith(resolution, {
            tenantId: entra.tenantId,
            useDeviceCode: true,
        });
        expect(finished.success).to.be.true;
    });

    test("stops a sign-in in progress when it is replaced or cancelled", async () => {
        const browserSignIn = createSignIn({ success: false });
        // A sign-in that never finishes on its own, like one left in a browser.
        browserSignIn.completion = new Promise(() => {});
        azureCli.resolve.resolves(resolution);
        azureCli.signIn.onFirstCall().returns(browserSignIn);
        const codeSignIn = createSignIn(
            { success: true },
            {
                userCode: "CODE1234",
                verificationUri: "https://microsoft.com/devicelogin",
            },
        );
        azureCli.signIn.onSecondCall().returns(codeSignIn);

        void runner.signInEntra(Dab.DabDeploymentStepAction.SignIn, entra);
        await new Promise((resolve) => setImmediate(resolve));
        await runner.signInEntra(Dab.DabDeploymentStepAction.SignInWithCode, entra);
        runner.cancelSignIn();

        expect(browserSignIn.cancel).to.have.been.calledOnce;
        expect(codeSignIn.cancel).to.have.been.calledOnce;
    });
});
