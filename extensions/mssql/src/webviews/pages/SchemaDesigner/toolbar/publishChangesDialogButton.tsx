/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, DialogTrigger, MessageBar, Tooltip } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useState } from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { useSchemaDesignerChangeContext } from "../definition/changes/schemaDesignerChangeContext";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { CopilotChat } from "../../../../sharedInterfaces/copilotChat";
import { ExecuteCommandRequest } from "../../../../sharedInterfaces/webview";
import { GithubCopilot16Regular } from "../../../common/icons/fluentIcons";
import {
    schemaDesignerPublishErrorDetailsLabel,
    schemaDesignerPublishErrorFallbackDetails,
    schemaDesignerPublishErrorPrompt,
} from "./publishChangesDialogPrompts";
import { LoadingLog } from "../../../common/loadingLog";
import {
    PublishDialogCenteredContent,
    PublishDialogFrame,
    PublishDialogReport,
} from "../../../common/publishDialog";

export enum PublishDialogStages {
    NotStarted = "notStarted",
    ReportLoading = "reportLoading",
    ReportError = "reportError",
    ReportSuccessNoChanges = "reportSuccessNoChanges",
    ReportSuccessWithChanges = "reportSuccessWithChanges",
    PublishLoading = "publishLoading",
    PublishError = "publishError",
    PublishSuccess = "publishSuccess",
}

type PublishChangesDialogState = {
    report: SchemaDesigner.GetReportResponse | undefined;
    reportError: string | undefined;
    isConfirmationChecked: boolean;
    reportTab: string;
    publishError: string | undefined;
    currentStage: PublishDialogStages;
};

export function buildSchemaDesignerPublishErrorPrompt(errorString: string): string {
    const errorDetails = errorString.trim() || schemaDesignerPublishErrorFallbackDetails;
    return `${schemaDesignerPublishErrorPrompt}

${schemaDesignerPublishErrorDetailsLabel}
\`\`\`
${errorDetails}
\`\`\``;
}

export function isReportOrPublishErrorStage(currentStage: PublishDialogStages): boolean {
    return (
        currentStage === PublishDialogStages.ReportError ||
        currentStage === PublishDialogStages.PublishError
    );
}

export function getReportOrPublishErrorForStage(
    currentStage: PublishDialogStages,
    reportError: string | undefined,
    publishError: string | undefined,
): string {
    if (currentStage === PublishDialogStages.ReportError) {
        return reportError ?? "";
    }
    if (currentStage === PublishDialogStages.PublishError) {
        return publishError ?? "";
    }
    return "";
}

export function shouldShowGithubCopilotFixButton(
    currentStage: PublishDialogStages,
    isCopilotChatInstalled: boolean,
): boolean {
    return isReportOrPublishErrorStage(currentStage) && isCopilotChatInstalled;
}

export function PublishChangesDialogButton() {
    const context = useContext(SchemaDesignerContext);
    const changeContext = useSchemaDesignerChangeContext();
    const isCopilotChatInstalled =
        useSchemaDesignerSelector((s) => s?.isCopilotChatInstalled) ?? false;
    const [open, setOpen] = useState(false);
    const [publishButtonDisabled, setPublishButtonDisabled] = useState(false);
    const hasSchemaChanges = changeContext.schemaChangesCount > 0;
    if (!context) {
        return undefined;
    }

    const [state, setState] = useState<PublishChangesDialogState>({
        report: undefined,
        reportError: undefined,
        isConfirmationChecked: false,
        reportTab: "report",
        publishError: undefined,
        currentStage: PublishDialogStages.NotStarted,
    });

    /**
     * Toolbar button to open the publish changes dialog.
     */
    const triggerButton = () => {
        return (
            <Tooltip content={locConstants.schemaDesigner.publishChanges} relationship="label">
                <Button
                    appearance="subtle"
                    size="small"
                    aria-label={locConstants.schemaDesigner.publishChanges}
                    title={locConstants.schemaDesigner.publishChanges}
                    icon={<FluentIcons.DatabaseArrowUp16Regular />}
                    disabled={publishButtonDisabled || !hasSchemaChanges}
                    onClick={async () => {
                        setOpen(true);
                        setState({
                            ...state,
                            currentStage: PublishDialogStages.ReportLoading,
                            reportError: undefined,
                            isConfirmationChecked: false,
                        });
                        setPublishButtonDisabled(true);
                        const getReportResponse = await context.getReport();
                        if (getReportResponse?.error) {
                            setState({
                                ...state,
                                currentStage: PublishDialogStages.ReportError,
                                reportError: getReportResponse.error,
                            });
                        } else {
                            if (!getReportResponse?.report.hasSchemaChanged) {
                                setState({
                                    ...state,
                                    currentStage: PublishDialogStages.ReportSuccessNoChanges,
                                    reportError: undefined,
                                    report: getReportResponse?.report,
                                });
                            } else {
                                setState({
                                    ...state,
                                    currentStage: PublishDialogStages.ReportSuccessWithChanges,
                                    reportError: undefined,
                                    report: getReportResponse.report,
                                    isConfirmationChecked: false,
                                });
                            }
                        }
                        setPublishButtonDisabled(false);
                    }}>
                    {locConstants.schemaDesigner.publishChanges}
                </Button>
            </Tooltip>
        );
    };

    const loadingLog = (label: string, messages: string[] = []) => {
        return <LoadingLog messages={messages} fallbackMessage={label} minHeight="100%" />;
    };

    const success = () => {
        return (
            <PublishDialogCenteredContent>
                <FluentIcons.CheckmarkCircleFilled
                    style={{
                        marginRight: "10px",
                        width: "50px",
                        height: "50px",
                    }}
                />
                {locConstants.schemaDesigner.changesPublishedSuccessfully}
            </PublishDialogCenteredContent>
        );
    };

    const reportContainer = () => {
        return (
            <PublishDialogReport
                markdown={state?.report?.dacReport?.report ?? ""}
                header={
                    <>
                        {state.report?.dacReport?.possibleDataLoss && (
                            <MessageBar
                                intent="warning"
                                style={{
                                    marginBottom: "10px",
                                    marginTop: "10px",
                                }}>
                                {locConstants.schemaDesigner.possibleDataLoss}
                            </MessageBar>
                        )}
                        {state.report?.dacReport?.hasWarnings && (
                            <MessageBar
                                intent="warning"
                                style={{
                                    marginBottom: "10px",
                                    marginTop: "10px",
                                }}>
                                {locConstants.schemaDesigner.hasWarnings}
                            </MessageBar>
                        )}
                    </>
                }
                confirmationLabel={locConstants.tableDesigner.designerPreviewConfirmation}
                confirmationChecked={state.isConfirmationChecked}
                onConfirmationChange={(checked) => {
                    setState({
                        ...state,
                        isConfirmationChecked: checked,
                    });
                }}
            />
        );
    };

    const dialogContent = () => {
        if (state.currentStage === PublishDialogStages.ReportLoading) {
            return loadingLog(
                context.reportProgressMessage ?? locConstants.schemaDesigner.generatingReport,
                context.reportProgressMessages,
            );
        }

        if (state.currentStage === PublishDialogStages.ReportError) {
            return loadingLog(
                state.reportError ?? locConstants.schemaDesigner.generatingReport,
                context.reportProgressMessages,
            );
        }

        if (state.currentStage === PublishDialogStages.ReportSuccessNoChanges) {
            return (
                <PublishDialogCenteredContent>
                    <FluentIcons.BranchFilled
                        style={{
                            marginRight: "10px",
                            width: "50px",
                            height: "50px",
                        }}
                    />
                    {locConstants.schemaDesigner.noChangesDetected}
                </PublishDialogCenteredContent>
            );
        }

        if (state.currentStage === PublishDialogStages.ReportSuccessWithChanges) {
            return reportContainer();
        }

        if (state.currentStage === PublishDialogStages.PublishLoading) {
            return loadingLog(
                locConstants.schemaDesigner.publishingChanges,
                context.publishProgressMessages,
            );
        }

        if (state.currentStage === PublishDialogStages.PublishError) {
            return loadingLog(
                state.publishError ?? locConstants.schemaDesigner.publishingChanges,
                context.publishProgressMessages,
            );
        }

        if (state.currentStage === PublishDialogStages.PublishSuccess) {
            return success();
        }
    };

    const isPublishButtonsVisible = () => {
        return state.currentStage === PublishDialogStages.ReportSuccessWithChanges;
    };

    const isPublishButtonsEnabled = () => {
        return (
            state.currentStage === PublishDialogStages.ReportSuccessWithChanges &&
            state.isConfirmationChecked
        );
    };

    const isGithubCopilotFixButtonVisible = () => {
        return shouldShowGithubCopilotFixButton(state.currentStage, isCopilotChatInstalled);
    };

    const getCurrentError = () => {
        return getReportOrPublishErrorForStage(
            state.currentStage,
            state.reportError,
            state.publishError,
        );
    };

    const openGithubCopilotToFixError = async () => {
        const prompt = buildSchemaDesignerPublishErrorPrompt(getCurrentError());
        setOpen(false);
        setState({
            ...state,
            isConfirmationChecked: false,
        });

        await context.extensionRpc.sendRequest(ExecuteCommandRequest.type, {
            command: CopilotChat.openFromUiCommand,
            args: [
                {
                    scenario: "schemaDesigner",
                    entryPoint: "schemaDesignerPublishDialogError",
                    prompt,
                },
            ],
        });
    };

    const footerButtons = () => {
        return (
            <>
                {isPublishButtonsVisible() && (
                    <>
                        <Button
                            appearance="primary"
                            disabled={!isPublishButtonsEnabled()}
                            onClick={async () => {
                                setState({
                                    ...state,
                                    currentStage: PublishDialogStages.PublishLoading,
                                    publishError: undefined,
                                });
                                const reponse = await context.publishSession();
                                if (reponse.error) {
                                    setState({
                                        ...state,
                                        currentStage: PublishDialogStages.PublishError,
                                        publishError: reponse.error,
                                    });
                                } else {
                                    setState({
                                        ...state,
                                        currentStage: PublishDialogStages.PublishSuccess,
                                    });
                                }
                            }}>
                            {locConstants.publishDialog.publish}
                        </Button>
                        <Button
                            appearance="secondary"
                            disabled={!isPublishButtonsEnabled()}
                            onClick={() => {
                                context.openInEditorWithConnection();
                            }}>
                            {locConstants.publishDialog.openPublishScript}
                        </Button>
                    </>
                )}
                {state.currentStage === PublishDialogStages.PublishSuccess && (
                    <DialogTrigger disableButtonEnhancement>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                setState({
                                    ...state,
                                    currentStage: PublishDialogStages.NotStarted,
                                });

                                context.resetUndoRedoState();
                            }}>
                            {locConstants.schemaDesigner.continueEditing}
                        </Button>
                    </DialogTrigger>
                )}
                {isGithubCopilotFixButtonVisible() && (
                    <Tooltip
                        content={locConstants.schemaDesigner.askGithubCopilotToFixTooltip}
                        relationship="description">
                        <Button
                            appearance="secondary"
                            icon={<GithubCopilot16Regular />}
                            title={locConstants.schemaDesigner.askGithubCopilotToFixTooltip}
                            onClick={async () => {
                                await openGithubCopilotToFixError();
                            }}>
                            {locConstants.schemaDesigner.askGithubCopilotToFix}
                        </Button>
                    </Tooltip>
                )}
                {state.currentStage !== PublishDialogStages.PublishLoading && (
                    <DialogTrigger disableButtonEnhancement>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                setState({
                                    ...state,
                                    isConfirmationChecked: false,
                                });

                                if (state.currentStage === PublishDialogStages.PublishSuccess) {
                                    context.closeDesigner();
                                }
                            }}>
                            {locConstants.schemaDesigner.Close}
                        </Button>
                    </DialogTrigger>
                )}
            </>
        );
    };

    return (
        <PublishDialogFrame
            open={open}
            onOpenChange={setOpen}
            trigger={triggerButton()}
            title={locConstants.publishDialog.publishChanges}
            content={dialogContent()}
            actions={footerButtons()}
        />
    );
}
