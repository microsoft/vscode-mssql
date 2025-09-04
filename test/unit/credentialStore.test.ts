/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as Contracts from "../../src/models/contracts";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { ICredentialStore } from "../../src/credentialstore/icredentialstore";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

suite("Credential Store Tests", () => {
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let credentialStore: ICredentialStore;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;

    setup(() => {
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        client
            .setup((c) => c.sendRequest(Contracts.SaveCredentialRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));
        client
            .setup((c) => c.sendRequest(Contracts.ReadCredentialRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        client
            .setup((c) => c.sendRequest(Contracts.DeleteCredentialRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        credentialStore = new CredentialStore(
            mockContext.object,
            TypeMoq.Mock.ofType<VscodeWrapper>().object,
            client.object,
        );
    });

    test("Read credential should send a ReadCredentialRequest", () => {
        void credentialStore.readCredential("test_credential").then(() => {
            client.verify(
                (c) => c.sendRequest(Contracts.ReadCredentialRequest.type, TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("Save credential should send a SaveCredentialRequest", () => {
        void credentialStore.saveCredential("test_credential", "test_password").then(() => {
            client.verify(
                (c) => c.sendRequest(Contracts.SaveCredentialRequest.type, TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("Delete credential should send a DeleteCredentialRequest", () => {
        void credentialStore.deleteCredential("test_credential").then(() => {
            client.verify(
                (c) => c.sendRequest(Contracts.DeleteCredentialRequest.type, TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });
});
