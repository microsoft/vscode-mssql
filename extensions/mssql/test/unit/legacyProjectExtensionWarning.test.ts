/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { LegacyProjectExtensionWarning } from "../../src/constants/locConstants";
import {
    getOutdatedLegacyProjectExtensionIds,
    legacyProjectExtensions,
    showLegacyProjectExtensionWarning,
} from "../../src/legacyProjectExtensionWarning";
import { logger } from "../../src/models/logger";

const { expect } = chai;
chai.use(sinonChai);

suite("Legacy project extension warning", () => {
    let sandbox: sinon.SinonSandbox;
    let getExtension: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        getExtension = sandbox.stub(vscode.extensions, "getExtension");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("does not warn when legacy extensions are not installed", async () => {
        const showWarningMessage = sandbox.stub(vscode.window, "showWarningMessage");

        await showLegacyProjectExtensionWarning();

        expect(showWarningMessage).not.to.have.been.called;
    });

    test("detects installed extensions at or below the migration versions", () => {
        getExtension.withArgs(legacyProjectExtensions[0].id).returns(extensionWithVersion("0.7.0"));
        getExtension.withArgs(legacyProjectExtensions[1].id).returns(extensionWithVersion("1.7.9"));

        expect(getOutdatedLegacyProjectExtensionIds()).to.deep.equal([
            legacyProjectExtensions[0].id,
            legacyProjectExtensions[1].id,
        ]);
    });

    test("ignores installed extensions newer than the migration versions", () => {
        getExtension.withArgs(legacyProjectExtensions[0].id).returns(extensionWithVersion("0.7.1"));
        getExtension.withArgs(legacyProjectExtensions[1].id).returns(extensionWithVersion("1.8.1"));

        expect(getOutdatedLegacyProjectExtensionIds()).to.be.empty;
    });

    test("opens only affected extensions when the user selects the action", async () => {
        getExtension.withArgs(legacyProjectExtensions[0].id).returns(extensionWithVersion("0.6.0"));
        getExtension.withArgs(legacyProjectExtensions[1].id).returns(extensionWithVersion("1.8.1"));
        sandbox
            .stub(vscode.window, "showWarningMessage")
            .resolves(LegacyProjectExtensionWarning.showExtensions as never);
        const executeCommand = sandbox.stub(vscode.commands, "executeCommand").resolves();

        await showLegacyProjectExtensionWarning();

        expect(executeCommand).to.have.been.calledOnceWithExactly(
            "workbench.extensions.action.showExtensionsWithIds",
            [legacyProjectExtensions[0].id],
        );
    });

    test("does not open extensions when the notification is dismissed", async () => {
        getExtension.withArgs(legacyProjectExtensions[0].id).returns(extensionWithVersion("0.7.0"));
        sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        const executeCommand = sandbox.stub(vscode.commands, "executeCommand");

        await showLegacyProjectExtensionWarning();

        expect(executeCommand).not.to.have.been.called;
    });

    test("shows an error when the affected extensions cannot be opened", async () => {
        getExtension.withArgs(legacyProjectExtensions[0].id).returns(extensionWithVersion("0.7.0"));
        sandbox
            .stub(vscode.window, "showWarningMessage")
            .resolves(LegacyProjectExtensionWarning.showExtensions as never);
        sandbox.stub(vscode.commands, "executeCommand").rejects(new Error("command failed"));
        sandbox.stub(logger, "error");
        const showErrorMessage = sandbox.stub(vscode.window, "showErrorMessage");

        await showLegacyProjectExtensionWarning();

        expect(showErrorMessage).to.have.been.calledOnceWithExactly(
            LegacyProjectExtensionWarning.showExtensionsFailed,
        );
    });
});

function extensionWithVersion(version: string): vscode.Extension<unknown> {
    return {
        packageJSON: { version },
    } as vscode.Extension<unknown>;
}
