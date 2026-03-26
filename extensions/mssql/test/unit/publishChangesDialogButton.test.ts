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
import {
    schemaDesignerPublishErrorDetailsLabel,
    schemaDesignerPublishErrorFallbackDetails,
    schemaDesignerPublishErrorPrompt,
} from "../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogPrompts";
import { ExecuteCommandRequest } from "../../src/sharedInterfaces/webview";

chai.use(sinonChai);

suite("PublishChangesDialogButton helpers", () => {
    let helpers: typeof import("../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton");
    const globalWithAcquireVsCodeApi = globalThis as typeof globalThis & {
        acquireVsCodeApi?: () => {
            postMessage: () => void;
            getState: () => unknown;
            setState: (state: unknown) => void;
        };
    };

    setup(() => {
        globalWithAcquireVsCodeApi.acquireVsCodeApi = () => ({
            postMessage: () => undefined,
            getState: () => undefined,
            setState: () => undefined,
        });

        delete require.cache[
            require.resolve(
                "../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton",
            )
        ];
        helpers = require("../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton");
    });

    teardown(() => {
        delete globalWithAcquireVsCodeApi.acquireVsCodeApi;
    });

    test("buildSchemaDesignerPublishErrorPrompt appends provided error details", () => {
        const prompt = helpers.buildSchemaDesignerPublishErrorPrompt("Some publish error");

        expect(prompt).to.equal(
            `${schemaDesignerPublishErrorPrompt}

${schemaDesignerPublishErrorDetailsLabel}
\`\`\`
Some publish error
\`\`\``,
        );
    });

    test("buildSchemaDesignerPublishErrorPrompt uses fallback text when error is empty", () => {
        const prompt = helpers.buildSchemaDesignerPublishErrorPrompt("   ");

        expect(prompt).to.contain(schemaDesignerPublishErrorFallbackDetails);
    });

    test("isReportOrPublishErrorStage returns true only for report and publish errors", () => {
        expect(
            helpers.isReportOrPublishErrorStage(helpers.PublishDialogStages.ReportError),
        ).to.equal(true);
        expect(
            helpers.isReportOrPublishErrorStage(helpers.PublishDialogStages.PublishError),
        ).to.equal(true);
        expect(
            helpers.isReportOrPublishErrorStage(helpers.PublishDialogStages.NotStarted),
        ).to.equal(false);
        expect(
            helpers.isReportOrPublishErrorStage(helpers.PublishDialogStages.ReportLoading),
        ).to.equal(false);
        expect(
            helpers.isReportOrPublishErrorStage(helpers.PublishDialogStages.PublishSuccess),
        ).to.equal(false);
    });

    test("getReportOrPublishErrorForStage returns report error for report stage", () => {
        const result = helpers.getReportOrPublishErrorForStage(
            helpers.PublishDialogStages.ReportError,
            "report problem",
            "publish problem",
        );

        expect(result).to.equal("report problem");
    });

    test("getReportOrPublishErrorForStage returns publish error for publish stage", () => {
        const result = helpers.getReportOrPublishErrorForStage(
            helpers.PublishDialogStages.PublishError,
            "report problem",
            "publish problem",
        );

        expect(result).to.equal("publish problem");
    });

    test("getReportOrPublishErrorForStage returns empty string for non-error stages", () => {
        const result = helpers.getReportOrPublishErrorForStage(
            helpers.PublishDialogStages.PublishLoading,
            "report problem",
            "publish problem",
        );

        expect(result).to.equal("");
    });

    test("shouldShowGithubCopilotFixButton returns true for report error when conditions are met", () => {
        const visible = helpers.shouldShowGithubCopilotFixButton(
            helpers.PublishDialogStages.ReportError,
            true,
        );

        expect(visible).to.equal(true);
    });

    test("shouldShowGithubCopilotFixButton returns true for publish error when conditions are met", () => {
        const visible = helpers.shouldShowGithubCopilotFixButton(
            helpers.PublishDialogStages.PublishError,
            true,
        );

        expect(visible).to.equal(true);
    });

    test("shouldShowGithubCopilotFixButton returns false when stage is not an error stage", () => {
        const visible = helpers.shouldShowGithubCopilotFixButton(
            helpers.PublishDialogStages.ReportSuccessWithChanges,
            true,
        );

        expect(visible).to.equal(false);
    });

    test("shouldShowGithubCopilotFixButton returns false when Copilot is unavailable", () => {
        const visible = helpers.shouldShowGithubCopilotFixButton(
            helpers.PublishDialogStages.PublishError,
            false,
        );

        expect(visible).to.equal(false);
    });
});

suite("PublishChangesDialogButton component", () => {
    let sandbox: sinon.SinonSandbox;
    let setOpenStub: sinon.SinonStub;
    let setStateStub: sinon.SinonStub;
    let sendRequestStub: sinon.SinonStub;
    let PublishChangesDialogButton: typeof import("../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton").PublishChangesDialogButton;
    let PublishDialogStages: typeof import("../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton").PublishDialogStages;

    type TestElementProps = {
        children?: React.ReactNode;
        title?: string;
        onClick?: () => void | Promise<void>;
    };

    const findElement = (
        node: React.ReactNode,
        predicate: (element: React.ReactElement<TestElementProps>) => boolean,
    ): React.ReactElement<TestElementProps> | undefined => {
        if (!React.isValidElement<TestElementProps>(node)) {
            return undefined;
        }

        if (predicate(node)) {
            return node;
        }

        for (const child of React.Children.toArray(node.props?.children)) {
            const match = findElement(child, predicate);
            if (match) {
                return match;
            }
        }
        return undefined;
    };

    setup(() => {
        const globalWithAcquireVsCodeApi = globalThis as typeof globalThis & {
            acquireVsCodeApi?: () => {
                postMessage: () => void;
                getState: () => unknown;
                setState: (state: unknown) => void;
            };
        };
        sandbox = sinon.createSandbox();
        globalWithAcquireVsCodeApi.acquireVsCodeApi = sandbox.stub().returns({
            postMessage: sandbox.stub(),
            getState: sandbox.stub(),
            setState: sandbox.stub(),
        });

        const styles = require("../../src/reactviews/common/styles");
        sandbox.stub(styles, "useMarkdownStyles").returns({
            markdownPage: "markdownPage",
        });

        const schemaDesignerStateProvider = require("../../src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider");
        const changeContext = require("../../src/reactviews/pages/SchemaDesigner/definition/changes/schemaDesignerChangeContext");
        sandbox.stub(changeContext, "useSchemaDesignerChangeContext").returns({
            schemaChangesCount: 1,
        });

        const schemaDesignerSelector = require("../../src/reactviews/pages/SchemaDesigner/schemaDesignerSelector");
        sandbox.stub(schemaDesignerSelector, "useSchemaDesignerSelector").returns(true);

        sendRequestStub = sandbox.stub().resolves(undefined);
        const schemaDesignerContextValue = {
            extensionRpc: {
                sendRequest: sendRequestStub,
            },
            getReport: sandbox.stub(),
            publishSession: sandbox.stub(),
            openInEditorWithConnection: sandbox.stub(),
            resetUndoRedoState: sandbox.stub(),
            closeDesigner: sandbox.stub(),
        };

        sandbox.stub(React, "useContext").callsFake((context: React.Context<unknown>) => {
            const contextWithCurrentValue = context as React.Context<unknown> & {
                _currentValue?: unknown;
            };
            if (context === schemaDesignerStateProvider.SchemaDesignerContext) {
                return schemaDesignerContextValue;
            }

            return contextWithCurrentValue._currentValue;
        });

        setOpenStub = sandbox.stub();
        const setPublishButtonDisabledStub = sandbox.stub();
        setStateStub = sandbox.stub();

        sandbox
            .stub(React, "useState")
            .onFirstCall()
            .returns([true, setOpenStub] as unknown as ReturnType<typeof React.useState>)
            .onSecondCall()
            .returns([false, setPublishButtonDisabledStub] as unknown as ReturnType<
                typeof React.useState
            >)
            .onThirdCall()
            .returns([
                {
                    report: undefined,
                    reportError: "report failure details",
                    isConfirmationChecked: true,
                    reportTab: "report",
                    publishError: undefined,
                    currentStage: "reportError",
                },
                setStateStub,
            ] as unknown as ReturnType<typeof React.useState>);

        delete require.cache[
            require.resolve(
                "../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton",
            )
        ];
        const publishChangesDialogButton = require("../../src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton");
        PublishChangesDialogButton = publishChangesDialogButton.PublishChangesDialogButton;
        PublishDialogStages = publishChangesDialogButton.PublishDialogStages;
    });

    teardown(() => {
        const globalWithAcquireVsCodeApi = globalThis as typeof globalThis & {
            acquireVsCodeApi?: () => unknown;
        };
        delete globalWithAcquireVsCodeApi.acquireVsCodeApi;
        sandbox.restore();
    });

    test("shows GHCP fix button in error stage and sends prompt override command", async () => {
        const dialogElement = PublishChangesDialogButton() as React.ReactElement<TestElementProps>;
        const ghcpFixButton = findElement(
            dialogElement,
            (element) =>
                element.props?.children === locConstants.schemaDesigner.askGithubCopilotToFix &&
                element.props?.title === locConstants.schemaDesigner.askGithubCopilotToFixTooltip &&
                typeof element.props?.onClick === "function",
        );

        expect(ghcpFixButton).to.not.be.undefined;
        await ghcpFixButton!.props.onClick();

        expect(setOpenStub).to.have.been.calledOnceWith(false);
        expect(setStateStub).to.have.been.calledOnceWith({
            report: undefined,
            reportError: "report failure details",
            isConfirmationChecked: false,
            reportTab: "report",
            publishError: undefined,
            currentStage: PublishDialogStages.ReportError,
        });
        expect(sendRequestStub).to.have.been.calledOnceWith(ExecuteCommandRequest.type, {
            command: CopilotChat.openFromUiCommand,
            args: [
                {
                    scenario: "schemaDesigner",
                    entryPoint: "schemaDesignerPublishDialogError",
                    prompt: `${schemaDesignerPublishErrorPrompt}

${schemaDesignerPublishErrorDetailsLabel}
\`\`\`
report failure details
\`\`\``,
                },
            ],
        });
    });
});
