/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as React from "react";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

chai.use(sinonChai);

suite("CopilotChatEntry", () => {
    let sandbox: sinon.SinonSandbox;
    let CopilotChatEntry: typeof import("../../src/reactviews/common/copilot/copilotChatEntry").CopilotChatEntry;

    setup(() => {
        sandbox = sinon.createSandbox();
        CopilotChatEntry =
            require("../../src/reactviews/common/copilot/copilotChatEntry").CopilotChatEntry;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("dismisses discovery before opening chat when discovery is open", async () => {
        const target = {} as HTMLButtonElement;
        sandbox
            .stub(React, "useState")
            .returns([target, sandbox.stub()] as unknown as ReturnType<typeof React.useState>);
        const onDismiss = sandbox.stub();
        const onOpenChat = sandbox.stub().resolves(undefined);

        const entryElement = CopilotChatEntry({
            label: "Chat",
            tooltip: "Open in GitHub Copilot Chat",
            onOpenChat,
            discovery: {
                open: true,
                title: "Title",
                body: "Body",
                primaryActionLabel: "Try it",
                secondaryActionLabel: "Dismiss",
                onDismiss,
            },
        }) as React.ReactElement<any>;

        const [buttonElement, popoverElement] = React.Children.toArray(
            entryElement.props.children,
        ) as React.ReactElement<any>[];

        await buttonElement.props.onClick();

        expect(onDismiss).to.have.been.calledOnce;
        expect(onOpenChat).to.have.been.calledOnce;
        expect(popoverElement.props.target).to.equal(target);
    });

    test("does not dismiss discovery when it is already closed", async () => {
        sandbox
            .stub(React, "useState")
            .returns([null, sandbox.stub()] as unknown as ReturnType<typeof React.useState>);
        const onDismiss = sandbox.stub();
        const onOpenChat = sandbox.stub().resolves(undefined);

        const entryElement = CopilotChatEntry({
            label: "Chat",
            tooltip: "Open in GitHub Copilot Chat",
            onOpenChat,
            discovery: {
                open: false,
                title: "Title",
                body: "Body",
                primaryActionLabel: "Try it",
                secondaryActionLabel: "Dismiss",
                onDismiss,
            },
        }) as React.ReactElement<any>;

        const [buttonElement] = React.Children.toArray(
            entryElement.props.children,
        ) as React.ReactElement<any>[];

        await buttonElement.props.onClick();

        expect(onDismiss).to.not.have.been.called;
        expect(onOpenChat).to.have.been.calledOnce;
    });

    test("renders only the button when discovery is not provided", () => {
        sandbox
            .stub(React, "useState")
            .returns([null, sandbox.stub()] as unknown as ReturnType<typeof React.useState>);

        const entryElement = CopilotChatEntry({
            label: "Chat",
            tooltip: "Open in GitHub Copilot Chat",
            onOpenChat: sandbox.stub(),
        }) as React.ReactElement<any>;

        const children = React.Children.toArray(entryElement.props.children);

        expect(children).to.have.length(1);
    });
});
