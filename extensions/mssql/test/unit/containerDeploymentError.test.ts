/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContainerDeploymentError } from "../../src/webviews/pages/Deployment/AzureSqlDatabase/containerDeploymentError";
import { locConstants } from "../../src/webviews/common/locConstants";

suite("Container deployment errors", () => {
    test("shows a concise summary and hides command output by default", () => {
        const message = locConstants.azureSqlDatabase.containerEngineNotRunning("Podman");
        const fullErrorText = "Command failed: podman info\nCannot connect to Podman socket";
        const markup = renderToStaticMarkup(
            createElement(ContainerDeploymentError, { message, fullErrorText }),
        );

        expect(markup).to.include(message);
        expect(markup).to.include(locConstants.localContainers.showFullErrorMessage);
        expect(markup).to.include('aria-expanded="false"');
        expect(markup).to.include("<button");
        expect(markup).not.to.include(fullErrorText);
        expect(markup).not.to.include("Command failed");
        expect(markup).not.to.include("Cannot connect to Podman socket");
    });

    test("omits the disclosure when no full error is available", () => {
        const message = locConstants.azureSqlContainer.provisioningFailed;
        const markup = renderToStaticMarkup(createElement(ContainerDeploymentError, { message }));

        expect(markup).to.include(message);
        expect(markup).not.to.include(locConstants.localContainers.showFullErrorMessage);
        expect(markup).not.to.include("<button");
    });

    test("keeps details available even without a summary", () => {
        const markup = renderToStaticMarkup(
            createElement(ContainerDeploymentError, { fullErrorText: "Raw command output" }),
        );

        expect(markup).to.include(locConstants.localContainers.showFullErrorMessage);
        expect(markup).not.to.include("Raw command output");
    });
});
