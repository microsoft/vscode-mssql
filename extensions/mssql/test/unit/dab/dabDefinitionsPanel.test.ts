/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    DAB_API_DIAGRAM_TAB_ID,
    openDabDefinitionsPanel,
} from "../../../src/webviews/pages/SchemaDesigner/dab/dabDefinitionsPanelUtils";
import { getDefinitionPanelScriptTabLabel } from "../../../src/webviews/common/definitionPanelUtils";

suite("DabDefinitionsPanel", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("openDabDefinitionsPanel resets the active tab to the DAB config tab before opening", () => {
        const openPanel = sandbox.stub();
        const setActiveTab = sandbox.stub();

        openDabDefinitionsPanel(
            {
                openPanel,
                closePanel: sandbox.stub(),
                togglePanel: sandbox.stub(),
                isCollapsed: sandbox.stub().returns(true),
            },
            setActiveTab,
        );

        expect(setActiveTab).to.have.been.calledWith("script");
        expect(openPanel).to.have.been.called;
    });

    test("registers a stable custom tab id for the API diagram", () => {
        expect(DAB_API_DIAGRAM_TAB_ID).to.equal("apiDiagram");
    });

    test("supports overriding the built-in script tab label", () => {
        expect(getDefinitionPanelScriptTabLabel("DAB Config")).to.equal("DAB Config");
        expect(getDefinitionPanelScriptTabLabel()).to.equal("Definition");
    });
});
