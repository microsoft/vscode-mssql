/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as React from "react";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { locConstants } from "../../src/reactviews/common/locConstants";
import { CopilotChat } from "../../src/sharedInterfaces/copilotChat";
import { ExecuteCommandRequest } from "../../src/sharedInterfaces/webview";

chai.use(sinonChai);

suite("SchemaDesignerWebviewCopilotChatEntry", () => {
    let sandbox: sinon.SinonSandbox;
    let schemaDesignerSelector: typeof import("../../src/reactviews/pages/SchemaDesigner/schemaDesignerSelector");
    let SchemaDesignerWebviewCopilotChatEntry: typeof import("../../src/reactviews/pages/SchemaDesigner/copilot/schemaDesignerWebviewCopilotChatEntry").SchemaDesignerWebviewCopilotChatEntry;
    let useRefStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        useRefStub = sandbox.stub(React, "useRef");
        (globalThis as any).acquireVsCodeApi = sandbox.stub().returns({
            postMessage: sandbox.stub(),
            getState: sandbox.stub(),
            setState: sandbox.stub(),
        });
        schemaDesignerSelector = require("../../src/reactviews/pages/SchemaDesigner/schemaDesignerSelector");
        SchemaDesignerWebviewCopilotChatEntry =
            require("../../src/reactviews/pages/SchemaDesigner/copilot/schemaDesignerWebviewCopilotChatEntry").SchemaDesignerWebviewCopilotChatEntry;
    });

    teardown(() => {
        delete (globalThis as any).acquireVsCodeApi;
        sandbox.restore();
    });

    const setupHookMocks = (
        contextValue: unknown,
        isCopilotChatInstalled: boolean,
        isDiscoveryDismissed = false,
    ) => {
        sandbox.stub(React, "useContext").returns(contextValue as any);
        sandbox.stub(React, "useCallback").callsFake((callback) => callback);
        sandbox.stub(React, "useEffect").callsFake(() => undefined);
        useRefStub.callsFake((value) => ({ current: value }));
        sandbox
            .stub(React, "useState")
            .returns([!isDiscoveryDismissed, sandbox.stub()] as unknown as ReturnType<
                typeof React.useState
            >);
        sandbox
            .stub(schemaDesignerSelector, "useSchemaDesignerSelector")
            .onFirstCall()
            .returns(isCopilotChatInstalled)
            .onSecondCall()
            .returns(isDiscoveryDismissed);
    };

    test("does not render when context is missing", () => {
        setupHookMocks(undefined, true);

        expect(
            SchemaDesignerWebviewCopilotChatEntry({
                scenario: "schemaDesigner",
                entryPoint: "schemaDesignerToolbar",
                discoveryTitle: "Discovery title",
                discoveryBody: "Discovery body",
                showDiscovery: true,
            }),
        ).to.be.null;
    });

    test("does not render when Copilot Chat is unavailable", () => {
        setupHookMocks({ extensionRpc: { sendRequest: sandbox.stub() } }, false);

        expect(
            SchemaDesignerWebviewCopilotChatEntry({
                scenario: "schemaDesigner",
                entryPoint: "schemaDesignerToolbar",
                discoveryTitle: "Discovery title",
                discoveryBody: "Discovery body",
                showDiscovery: true,
            }),
        ).to.be.null;
    });

    test("renders with expected localized label, tooltip, and discovery copy", () => {
        setupHookMocks({ extensionRpc: { sendRequest: sandbox.stub() } }, true);

        const entryElement = SchemaDesignerWebviewCopilotChatEntry({
            scenario: "schemaDesigner",
            entryPoint: "schemaDesignerToolbar",
            discoveryTitle: "Discovery title",
            discoveryBody: "Discovery body",
            showDiscovery: true,
        }) as React.ReactElement<any>;

        expect(entryElement.props.label).to.equal(
            locConstants.schemaDesigner.openCopilotForSchemaDesigner,
        );
        expect(entryElement.props.tooltip).to.equal(
            locConstants.schemaDesigner.openCopilotForSchemaDesignerTooltip,
        );
        expect(entryElement.props.discovery.title).to.equal("Discovery title");
        expect(entryElement.props.discovery.body).to.equal("Discovery body");
        expect(entryElement.props.discovery.primaryActionLabel).to.equal(locConstants.common.tryIt);
        expect(entryElement.props.discovery.secondaryActionLabel).to.equal(
            locConstants.common.dismiss,
        );
        expect(entryElement.props.discovery.open).to.equal(true);
    });

    test("sends the shared copilot chat command with scenario args when opened", async () => {
        const sendRequestStub = sandbox.stub().resolves(undefined);
        const actionStub = sandbox.stub();
        setupHookMocks(
            { extensionRpc: { sendRequest: sendRequestStub, action: actionStub } },
            true,
        );

        const entryElement = SchemaDesignerWebviewCopilotChatEntry({
            scenario: "schemaDesigner",
            entryPoint: "schemaDesignerToolbar",
            discoveryTitle: "Discovery title",
            discoveryBody: "Discovery body",
            showDiscovery: true,
        }) as React.ReactElement<any>;

        await entryElement.props.onOpenChat();

        expect(sendRequestStub).to.have.been.calledOnceWith(ExecuteCommandRequest.type, {
            command: CopilotChat.openFromUiCommand,
            args: [{ scenario: "schemaDesigner", entryPoint: "schemaDesignerToolbar" }],
        });
        expect(actionStub).to.not.have.been.called;
    });

    test("dismisses discovery state only once", () => {
        const actionStub = sandbox.stub();
        setupHookMocks({ extensionRpc: { sendRequest: sandbox.stub(), action: actionStub } }, true);

        const entryElement = SchemaDesignerWebviewCopilotChatEntry({
            scenario: "schemaDesigner",
            entryPoint: "schemaDesignerToolbar",
            discoveryTitle: "Discovery title",
            discoveryBody: "Discovery body",
            showDiscovery: true,
        }) as React.ReactElement<any>;

        entryElement.props.discovery.onDismiss();
        entryElement.props.discovery.onDismiss();

        expect(actionStub).to.have.been.calledOnceWith("dismissCopilotChatDiscovery", {
            scenario: "schemaDesigner",
        });
    });

    test("does not open discovery for an inactive surface", () => {
        setupHookMocks(
            { extensionRpc: { sendRequest: sandbox.stub(), action: sandbox.stub() } },
            true,
            false,
        );

        const entryElement = SchemaDesignerWebviewCopilotChatEntry({
            scenario: "schemaDesigner",
            entryPoint: "schemaDesignerToolbar",
            discoveryTitle: "Discovery title",
            discoveryBody: "Discovery body",
            showDiscovery: false,
        }) as React.ReactElement<any>;

        expect(entryElement.props.discovery.open).to.equal(false);
    });

    test("does not reopen discovery when the surface has already been dismissed", () => {
        setupHookMocks(
            { extensionRpc: { sendRequest: sandbox.stub(), action: sandbox.stub() } },
            true,
            true,
        );

        const entryElement = SchemaDesignerWebviewCopilotChatEntry({
            scenario: "dab",
            entryPoint: "dabToolbar",
            discoveryTitle: "Discovery title",
            discoveryBody: "Discovery body",
            showDiscovery: true,
        }) as React.ReactElement<any>;

        expect(entryElement.props.discovery.open).to.equal(false);
    });
});
