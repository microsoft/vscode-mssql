/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    makeStyles,
    MessageBar,
    Spinner,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useState } from "react";
import Markdown from "react-markdown";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

enum PublishDialogStages {
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

const useStyles = makeStyles({
    errorSection: {
        marginBottom: "15px",
        lineHeight: 1.5,
    },
    sectionNumber: {
        fontWeight: "bold",
        marginRight: "5px",
    },
});

export function PublishChangesDialogButton() {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);
    const [open, setOpen] = useState(false);
    const [publishButtonDisabled, setPublishButtonDisabled] = useState(false);
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
            <Button
                size="small"
                appearance="subtle"
                icon={<FluentIcons.DatabaseArrowUp16Filled />}
                title={locConstants.schemaDesigner.publishChanges}
                disabled={publishButtonDisabled}
                onClick={async () => {
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
                    setOpen(true);
                    setPublishButtonDisabled(false);
                }}>
                {locConstants.schemaDesigner.publishChanges}
            </Button>
        );
    };

    const spinner = (label: string) => {
        return (
            <Spinner
                size="large"
                style={{
                    marginBottom: "10px",
                    marginTop: "10px",
                }}
                label={label}
                labelPosition="below"
            />
        );
    };

    const error = (errorString: string) => {
        // Split the error message into sections
        const formatErrorMessage = (errorString: string) => {
            // Split by numbered points (1., 2., 3., etc.)
            const sections = errorString.split(/(\d+\.\s)/g);

            // Create an array of formatted sections
            const formattedSections = [];

            for (let i = 0; i < sections.length; i++) {
                if (sections[i].match(/^\d+\.\s$/)) {
                    // This is a number prefix
                    const sectionNumber = sections[i];
                    const sectionContent = sections[i + 1] || "";

                    formattedSections.push(
                        <div key={i} className={classes.errorSection}>
                            <strong className={classes.sectionNumber}>{sectionNumber}</strong>
                            <span>{sectionContent}</span>
                        </div>,
                    );

                    i++; // Skip the next section as we've already used it
                } else if (sections[i].trim()) {
                    // This is an unnumbered section
                    formattedSections.push(
                        <div key={i} className={classes.errorSection}>
                            <span>{sections[i]}</span>
                        </div>,
                    );
                }
            }

            return formattedSections;
        };

        return (
            <div
                className="error-container"
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "200px",
                }}>
                <FluentIcons.ErrorCircleFilled
                    style={{
                        marginRight: "10px",
                        width: "50px",
                        height: "50px",
                    }}
                />
                <div className="error-body">{formatErrorMessage(errorString)}</div>
            </div>
        );
    };

    const success = () => {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "200px",
                }}>
                <FluentIcons.CheckmarkCircleFilled
                    style={{
                        marginRight: "10px",
                        width: "50px",
                        height: "50px",
                    }}
                />
                {locConstants.schemaDesigner.changesPublishedSuccessfully}
            </div>
        );
    };

    const reportContainer = () => {
        return (
            <>
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}>
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
                    <div
                        style={{
                            width: "100%",
                            height: "500px",
                            maxHeight: "100%",
                            overflow: "auto",
                        }}>
                        <Markdown>{state?.report?.dacReport?.report ?? ""}</Markdown>
                    </div>

                    <Checkbox
                        label={locConstants.tableDesigner.designerPreviewConfirmation}
                        style={{
                            margin: "5px",
                        }}
                        required
                        checked={state.isConfirmationChecked}
                        onChange={(_event, data) => {
                            setState({
                                ...state,
                                isConfirmationChecked: data.checked as boolean,
                            });
                        }}
                        // Setting initial focus on the checkbox when it is rendered.
                        autoFocus
                        /**
                         * The focus outline is not visible on the checkbox when it is focused programmatically.
                         * This is a workaround to make the focus outline visible on the checkbox when it is focused programmatically.
                         * This is most likely a bug in the browser.
                         */
                        onFocus={(event) => {
                            if (event.target.parentElement) {
                                event.target.parentElement.style.outlineStyle = "solid";
                                event.target.parentElement.style.outlineColor =
                                    "var(--vscode-focusBorder)";
                            }
                        }}
                        onBlur={(event) => {
                            if (event.target.parentElement) {
                                event.target.parentElement.style.outline = "none";
                                event.target.parentElement.style.outlineColor = "";
                            }
                        }}
                    />
                </div>
            </>
        );
    };

    const dialogContent = () => {
        if (state.currentStage === PublishDialogStages.ReportLoading) {
            return spinner(locConstants.schemaDesigner.generatingReport);
        }

        if (state.currentStage === PublishDialogStages.ReportError) {
            return error(state.reportError ?? "");
        }

        if (state.currentStage === PublishDialogStages.ReportSuccessNoChanges) {
            return (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: "200px",
                    }}>
                    <FluentIcons.BranchFilled
                        style={{
                            marginRight: "10px",
                            width: "50px",
                            height: "50px",
                        }}
                    />
                    {locConstants.schemaDesigner.noChangesDetected}
                </div>
            );
        }

        if (state.currentStage === PublishDialogStages.ReportSuccessWithChanges) {
            return reportContainer();
        }

        if (state.currentStage === PublishDialogStages.PublishLoading) {
            return spinner(locConstants.schemaDesigner.publishingChanges);
        }

        if (state.currentStage === PublishDialogStages.PublishError) {
            return error(state.publishError ?? "");
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
                            {locConstants.schemaDesigner.publish}
                        </Button>
                        <Button
                            appearance="secondary"
                            disabled={!isPublishButtonsEnabled()}
                            onClick={() => {
                                context.openInEditorWithConnection();
                            }}>
                            {locConstants.schemaDesigner.openPublishScript}
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
        <Dialog open={open} onOpenChange={(_e, data) => setOpen(data.open)}>
            {triggerButton()}
            <DialogSurface
                style={{
                    width: "100%",
                    maxWidth: "800px",
                }}>
                <DialogBody>
                    <DialogTitle>{locConstants.schemaDesigner.publishChanges}</DialogTitle>
                    <DialogContent>{dialogContent()}</DialogContent>
                    <DialogActions>{footerButtons()}</DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
