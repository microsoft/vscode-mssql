/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import * as Contracts from "../../src/models/contracts";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { ICredentialStore } from "../../src/credentialstore/icredentialstore";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

chai.use(sinonChai);

suite("Credential Store Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
  let credentialStore: ICredentialStore;
  let secretStorage: {
    get: sinon.SinonStub<[string], Promise<string | undefined>>;
    store: sinon.SinonStub<[string, string], Promise<void>>;
    delete: sinon.SinonStub<[string], Promise<void>>;
  };
  let context: vscode.ExtensionContext;
  let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
  let saveRequestStub: sinon.SinonStub;
  let readRequestStub: sinon.SinonStub;
  let deleteRequestStub: sinon.SinonStub;

  const credentialId = "test_credential";

  setup(() => {
    sandbox = sinon.createSandbox();

    client = sandbox.createStubInstance(SqlToolsServiceClient);

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

    saveRequestStub = client.sendRequest
      .withArgs(Contracts.SaveCredentialRequest.type, sinon.match.any)
      .resolves(true);
    readRequestStub = client.sendRequest
      .withArgs(Contracts.ReadCredentialRequest.type, sinon.match.any)
      .resolves(undefined);
    deleteRequestStub = client.sendRequest
      .withArgs(Contracts.DeleteCredentialRequest.type, sinon.match.any)
      .resolves(undefined);

    vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);

    credentialStore = new CredentialStore(context, vscodeWrapper, client);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Read credential should send a ReadCredentialRequest when secret storage misses", async () => {
    const serverCredential: Contracts.Credential = new Contracts.Credential();
    serverCredential.credentialId = credentialId;
    serverCredential.password = "test_password";

    readRequestStub.resolves(serverCredential);

    await credentialStore.readCredential(credentialId);

    expect(secretStorage.get).to.have.been.calledOnceWithExactly(credentialId);
    expect(readRequestStub).to.have.been.calledOnceWithExactly(
      Contracts.ReadCredentialRequest.type,
      sinon.match.has("credentialId", credentialId),
    );
    expect(secretStorage.store).to.have.been.calledOnceWithExactly(
      credentialId,
      serverCredential.password,
    );
    expect(deleteRequestStub).to.have.been.calledOnceWithExactly(
      Contracts.DeleteCredentialRequest.type,
      sinon.match.has("credentialId", credentialId),
    );
  });

  test("Save credential should store in secret storage", async () => {
    await credentialStore.saveCredential(credentialId, "test_password");

    expect(secretStorage.store).to.have.been.calledOnceWithExactly(
      credentialId,
      "test_password",
    );
    expect(saveRequestStub).to.not.have.been.called;
  });

  test("Delete credential should remove from secret storage and request delete", async () => {
    await credentialStore.deleteCredential(credentialId);

    expect(secretStorage.delete).to.have.been.calledOnceWithExactly(
      credentialId,
    );
    expect(deleteRequestStub).to.have.been.calledWithExactly(
      Contracts.DeleteCredentialRequest.type,
      sinon.match.has("credentialId", credentialId),
    );
  });
});
