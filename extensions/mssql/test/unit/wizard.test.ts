/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as sinon from "sinon";
import { Wizard } from "../../src/webviews/common/wizard";
import { locConstants } from "../../src/webviews/common/locConstants";

suite("Wizard cancellation", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => sandbox.restore());

    for (const canGoBack of [false, true]) {
        test(`honors the provisioning page's Previous availability when ${canGoBack}`, () => {
            const markup = renderToStaticMarkup(
                createElement(Wizard, {
                    title: "Deployment",
                    pages: [
                        { id: "configuration", title: "Configuration", render: () => null },
                        {
                            id: "provisioning",
                            title: "Setting up",
                            render: () => null,
                            canGoBack,
                            canGoNext: false,
                        },
                    ],
                    initialPageId: "provisioning",
                    onCancel: sandbox.stub(),
                }),
            );
            const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
            const previousButton = buttons.find((button) =>
                button.includes(locConstants.common.previous),
            );
            expect(previousButton).not.to.be.undefined;
            expect(previousButton?.includes('disabled=""')).to.equal(!canGoBack);
            const finishButton = buttons.find((button) =>
                button.includes(locConstants.common.finish),
            );
            expect(finishButton).to.include('disabled=""');
        });
    }

    for (const isCancelling of [false, true]) {
        test(`renders cancellation progress when pending is ${isCancelling}`, () => {
            const markup = renderToStaticMarkup(
                createElement(Wizard, {
                    title: "Deployment",
                    pages: [
                        { id: "configuration", title: "Configuration", render: () => null },
                        { id: "provisioning", title: "Setting up", render: () => null },
                    ],
                    initialPageId: "provisioning",
                    onCancel: sandbox.stub(),
                    isCancelling,
                }),
            );
            const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
            expect(buttons).to.have.length(3);
            const cancelButton = buttons.find((button) => button.includes("Cancel"));
            expect(cancelButton).to.include(`aria-busy="${isCancelling}"`);
            if (isCancelling) {
                expect(cancelButton).to.include("fui-Spinner");
                for (const button of buttons) {
                    expect(button).to.include('disabled=""');
                }
            } else {
                expect(cancelButton).not.to.include("fui-Spinner");
                for (const button of buttons) {
                    expect(button).not.to.include('disabled=""');
                }
            }
        });
    }
});
