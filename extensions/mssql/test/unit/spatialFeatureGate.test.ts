/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { previewService } from "../../src/previews/previewService";
import { isSpatialResultsEnabled } from "../../src/queryResults/spatial/spatialFeatureGate";

suite("Spatial preview gate", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("requires both the complete Query Studio preview chain and spatial opt-in", () => {
        const preview = sandbox.stub(previewService, "isPrivatePreviewEnabled").returns(false);
        const get = sandbox.stub().returns(true);
        sandbox
            .stub(vscode.workspace, "getConfiguration")
            .returns({ get } as unknown as vscode.WorkspaceConfiguration);
        expect(isSpatialResultsEnabled()).to.equal(false);
        preview.returns(true);
        get.returns(undefined);
        expect(isSpatialResultsEnabled()).to.equal(false);
        get.returns(false);
        expect(isSpatialResultsEnabled()).to.equal(false);
        get.returns(true);
        expect(isSpatialResultsEnabled()).to.equal(true);
        preview.returns(false);
        expect(isSpatialResultsEnabled()).to.equal(false);
    });
});
