/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { ICredentialStore } from "../../src/credentialstore/icredentialstore";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

chai.use(sinonChai);

suite("Credential Store Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let credentialStore: ICredentialStore;
    let secretStorage: {
        get: sinon.SinonStub<[string], Promise<string | undefined>>;
        store: sinon.SinonStub<[string, string], Promise<void>>;
        delete: sinon.SinonStub<[string], Promise<void>>;
    };
    let context: vscode.ExtensionContext;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    const credentialId = "test_credential";

    setup(() => {
        sandbox = sinon.createSandbox();

        secretStorage = {
            get: sandbox.stub<[string], Promise<string | undefined>>(),
            store: sandbox.stub<[string, string], Promise<void>>(),
            delete: sandbox.stub<[string], Promise<void>>(),
        };

        secretStorage.get.resolves(undefined);
        secretStorage.store.resolves();
        secretStorage.delete.resolves();

        context = {
            secrets: secretStorage as unknown as vscode.SecretStorage,
        } as vscode.ExtensionContext;

        vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);

        credentialStore = new CredentialStore(context, vscodeWrapper);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Read credential should return undefined when secret storage misses", async () => {
        const result = await credentialStore.readCredential(credentialId);

        expect(secretStorage.get).to.have.been.calledOnceWithExactly(credentialId);
        expect(secretStorage.store).to.not.have.been.called;
        expect(result).to.equal(undefined);
    });

    test("Read credential should return stored credential when present", async () => {
        secretStorage.get.resolves("test_password");

        const result = await credentialStore.readCredential(credentialId);

        expect(secretStorage.get).to.have.been.calledOnceWithExactly(credentialId);
        expect(result?.credentialId).to.equal(credentialId);
        expect(result?.password).to.equal("test_password");
    });

    test("Save credential should store in secret storage", async () => {
        await credentialStore.saveCredential(credentialId, "test_password");

        expect(secretStorage.store).to.have.been.calledOnceWithExactly(
            credentialId,
            "test_password",
        );
    });

    test("Delete credential should remove from secret storage", async () => {
        await credentialStore.deleteCredential(credentialId);

        expect(secretStorage.delete).to.have.been.calledOnceWithExactly(credentialId);
    });
});
