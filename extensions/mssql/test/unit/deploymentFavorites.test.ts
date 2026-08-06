/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import {
    applyFavorites,
    getFavoriteIds,
    toggleFavorite,
} from "../../src/deployment/deploymentFavorites";
import { configSelectedAzureSubscriptions } from "../../src/constants/constants";
import { FavoriteResourceType, FormItemOptions } from "../../src/sharedInterfaces/form";

chai.use(sinonChai);

suite("Deployment Favorites", () => {
    let sandbox: sinon.SinonSandbox;
    let get: sinon.SinonStub;
    let update: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        get = sandbox.stub();
        update = sandbox.stub().resolves();
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get,
            update,
        } as unknown as vscode.WorkspaceConfiguration);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("sorts favorites by insertion order and decorates options", () => {
        get.returns(["two", "one"]);
        const options: FormItemOptions[] = [
            { displayName: "One", value: "one" },
            { displayName: "Two", value: "two" },
            { displayName: "Three", value: "three" },
        ];

        const result = applyFavorites(options, FavoriteResourceType.AzureSubscription);

        expect(result.map((option) => option.value)).to.deep.equal(["two", "one", "three"]);
        expect(result[0]).to.include({
            favoriteResourceType: FavoriteResourceType.AzureSubscription,
            favoriteId: "two",
            isFavorite: true,
            favoriteOrder: 0,
        });
        expect(result[1].favoriteOrder).to.equal(1);
        expect(result[2].isFavorite).to.equal(false);
        expect(result[2].favoriteOrder).to.equal(undefined);
    });

    test("uses scoped favorite IDs", () => {
        get.returns(["subscription/resource-group"]);

        const result = applyFavorites(
            [{ displayName: "resource-group", value: "resource-group" }],
            FavoriteResourceType.AzureResourceGroup,
            (option) => `subscription/${option.value}`,
        );

        expect(result[0].favoriteId).to.equal("subscription/resource-group");
        expect(result[0].isFavorite).to.equal(true);
    });

    test("reads legacy Azure subscription favorite IDs", () => {
        get.returns(["tenant/subscription"]);

        const result = getFavoriteIds(FavoriteResourceType.AzureSubscription);

        expect(result).to.deep.equal(["subscription"]);
    });

    test("persists a new favorite globally", async () => {
        get.returns(["existing"]);

        const result = await toggleFavorite(FavoriteResourceType.AzureSubscription, "subscription");

        expect(result).to.deep.equal(["existing", "subscription"]);
        expect(update).to.have.been.calledWith(
            configSelectedAzureSubscriptions,
            ["existing", "subscription"],
            vscode.ConfigurationTarget.Global,
        );
    });

    test("removes an existing favorite", async () => {
        get.returns(["subscription", "other"]);

        const result = await toggleFavorite(FavoriteResourceType.AzureSubscription, "subscription");

        expect(result).to.deep.equal(["other"]);
    });
});
