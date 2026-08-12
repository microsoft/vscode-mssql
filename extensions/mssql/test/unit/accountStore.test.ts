/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { InstantiationServiceBuilder, ServiceDescriptor } from "extension-toolkit/base";
import { ExtensionContextService, IExtensionContextService } from "extension-toolkit/vscode";
import { AccountStore, IAccountStore } from "../../src/azure/accountStore";
import * as Constants from "../../src/constants/constants";
import { AccountType, IAccount } from "../../src/models/contracts/azure";
import { stubExtensionContext } from "./utils";

chai.use(sinonChai);

function createTestAccount(id: string): IAccount {
    return {
        key: { id, providerId: "test-provider" },
        displayInfo: {
            accountType: AccountType.Microsoft,
            userId: id,
            displayName: `Display ${id}`,
            email: `${id}@contoso.com`,
            name: `Name ${id}`,
        },
        properties: {} as IAccount["properties"],
        isStale: false,
    };
}

suite("Account Store Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let accountStore: IAccountStore;

    setup(() => {
        sandbox = sinon.createSandbox();
        context = stubExtensionContext(sandbox);
        accountStore = new AccountStore(new ExtensionContextService(context));
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Returns an empty array when no accounts are stored", async () => {
        const result = await accountStore.getAccounts();

        expect(result).to.deep.equal([]);
    });

    test("Adds a valid account and persists it to global state", async () => {
        const account = createTestAccount("account-1");

        const added = await accountStore.addAccount(account);

        expect(added).to.be.true;
        expect(context.globalState.update).to.have.been.calledOnceWithExactly(
            Constants.configAzureAccount,
            [account],
        );
    });

    test("Rejects an incomplete account and does not persist it", async () => {
        const invalidAccount = {
            key: undefined,
            displayInfo: undefined,
            properties: {} as IAccount["properties"],
            isStale: false,
        } as unknown as IAccount;

        const added = await accountStore.addAccount(invalidAccount);

        expect(added).to.be.false;
        expect(context.globalState.update).to.not.have.been.called;
    });

    test("Removes an account by key", async () => {
        const account = createTestAccount("account-1");
        (context.globalState.get as sinon.SinonStub).returns([account]);

        await accountStore.removeAccount("account-1");

        expect(context.globalState.update).to.have.been.calledOnceWithExactly(
            Constants.configAzureAccount,
            [],
        );
    });

    test("Clears all saved accounts", async () => {
        await accountStore.clearAccounts();

        expect(context.globalState.update).to.have.been.calledOnceWithExactly(
            Constants.configAzureAccount,
            [],
        );
    });

    suite("Dependency injection", () => {
        test("Resolves a cached AccountStore instance backed by the registered extension context", async () => {
            const builder = new InstantiationServiceBuilder();
            builder.define(IExtensionContextService, new ExtensionContextService(context));
            builder.define(IAccountStore, new ServiceDescriptor(AccountStore));
            const instantiationService = builder.seal();

            const first = instantiationService.invokeFunction((accessor) =>
                accessor.get(IAccountStore),
            );
            const second = instantiationService.invokeFunction((accessor) =>
                accessor.get(IAccountStore),
            );

            expect(first).to.equal(second);

            const account = createTestAccount("account-2");
            await first.addAccount(account);

            expect(context.globalState.update).to.have.been.calledWith(
                Constants.configAzureAccount,
                [account],
            );
        });
    });
});
