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
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { ExecuteCommandRequest } from "../../src/sharedInterfaces/webview";

chai.use(sinonChai);

suite("OpenCopilotChatButton", () => {
    let sandbox: sinon.SinonSandbox;
    let schemaDesignerSelector: typeof import("../../src/reactviews/pages/SchemaDesigner/schemaDesignerSelector");
    let OpenCopilotChatButton: typeof import("../../src/reactviews/pages/SchemaDesigner/toolbar/openCopilotChatButton").OpenCopilotChatButton;

    setup(() => {
        sandbox = sinon.createSandbox();
        (globalThis as any).acquireVsCodeApi = sandbox.stub().returns({
            postMessage: sandbox.stub(),
            getState: sandbox.stub(),
            setState: sandbox.stub(),
        });
        schemaDesignerSelector = require("../../src/reactviews/pages/SchemaDesigner/schemaDesignerSelector");
        OpenCopilotChatButton =
            require("../../src/reactviews/pages/SchemaDesigner/toolbar/openCopilotChatButton").OpenCopilotChatButton;
    });

    teardown(() => {
        delete (globalThis as any).acquireVsCodeApi;
        sandbox.restore();
    });

    const setupHookMocks = (contextValue: unknown, isCopilotChatInstalled: boolean) => {
        sandbox.stub(React, "useContext").returns(contextValue as any);
        sandbox
            .stub(schemaDesignerSelector, "useSchemaDesignerSelector")
            .returns(isCopilotChatInstalled);
    };

    test("does not render when context is missing", () => {
        setupHookMocks(undefined, true);

        expect(OpenCopilotChatButton()).to.be.undefined;
    });

    test("does not render when Copilot Chat is unavailable", () => {
        setupHookMocks({ extensionRpc: { sendRequest: sandbox.stub() } }, false);

        expect(OpenCopilotChatButton()).to.be.undefined;
    });

    test("renders with expected localized label and tooltip", () => {
        setupHookMocks({ extensionRpc: { sendRequest: sandbox.stub() } }, true);

        const tooltipElement = OpenCopilotChatButton() as React.ReactElement<any>;
        const buttonElement = tooltipElement.props.children as React.ReactElement<any>;

        expect(tooltipElement.props.content).to.equal(
            locConstants.schemaDesigner.openCopilotForSchemaDesignerTooltip,
        );
        expect(buttonElement.props.children).to.equal(
            locConstants.schemaDesigner.openCopilotForSchemaDesigner,
        );
    });

    test("sends the schema designer copilot command when clicked", async () => {
        const sendRequestStub = sandbox.stub().resolves(undefined);
        setupHookMocks({ extensionRpc: { sendRequest: sendRequestStub } }, true);

        const tooltipElement = OpenCopilotChatButton() as React.ReactElement<any>;
        const buttonElement = tooltipElement.props.children as React.ReactElement<any>;

        await buttonElement.props.onClick();

        expect(sendRequestStub).to.have.been.calledOnceWith(ExecuteCommandRequest.type, {
            command: SchemaDesigner.openCopilotAgentCommand,
        });
    });
});
