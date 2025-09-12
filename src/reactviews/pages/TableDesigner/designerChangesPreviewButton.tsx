/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Checkbox,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Spinner,
    makeStyles,
} from "@fluentui/react-components";
import { CopyRegular, DatabaseArrowUp16Regular, ErrorCircleRegular } from "@fluentui/react-icons";
import {
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
} from "@fluentui/react-dialog";
import { useContext, useState } from "react";

import { Button } from "@fluentui/react-button";
import { LoadState } from "../../../sharedInterfaces/tableDesigner";
import ReactMarkdown from "react-markdown";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    dialogContent: {
        height: "300px",
        overflow: "auto",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        flexDirection: "column",
    },
    openScript: {
        width: "150px",
    },
    updateDatabase: {
        width: "150px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
        color: "var(--vscode-errorForeground)",
    },
    dialogFooterButtons: {
        marginTop: "10px",
    },
    markdownContainer: {
        width: "calc(100% - 40px)",
        height: "calc(100% - 80px)",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid #e0e0e0",
        overflow: "auto",
        padding: "10px 5px 5px 10px",
        margin: "5px",
        backgroundColor: "var(--vscode-editor-background)",
    },
});

export const DesignerChangesPreviewButton = () => {
    const designerContext = useContext(TableDesignerContext);
    const classes = useStyles();
    if (!designerContext) {
        return null;
    }

    const [isConfirmationChecked, setIsConfirmationChecked] = useState(false);

    const state = designerContext.state;

    const generateScriptIcon = () => {
        switch (state?.apiState?.generateScriptState) {
            case LoadState.Loading:
                return <Spinner size="extra-small" />;
            case LoadState.Error:
                return <ErrorCircleRegular />;
            default:
                return undefined;
        }
    };

    const getDialogCloseButton = () => {
        return (
            <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" onClick={() => setIsConfirmationChecked(false)}>
                    {locConstants.common.close}
                </Button>
            </DialogTrigger>
        );
    };

    const publishingLoadingDialogContents = () => (
        <>
            <DialogContent className={classes.dialogContent}>
                <Spinner
                    label={locConstants.tableDesigner.publishingChanges}
                    labelPosition="below"
                />
            </DialogContent>
        </>
    );

    const publishingErrorDialogContents = () => (
        <>
            <DialogContent>
                <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                    <MessageBarBody
                        style={{
                            textAlign: "justify",
                        }}>
                        {state?.publishingError ?? ""}
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button
                            onClick={() => designerContext.copyPublishErrorToClipboard()}
                            icon={<CopyRegular />}>
                            {locConstants.tableDesigner.copy}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            </DialogContent>
            <DialogActions>
                <Button
                    appearance="primary"
                    onClick={() => {
                        designerContext.publishChanges();
                    }}>
                    {locConstants.tableDesigner.retry}
                </Button>
                <Button
                    onClick={() => {
                        setIsConfirmationChecked(false);
                        designerContext.generatePreviewReport();
                    }}
                    style={{
                        width: "150px",
                    }}>
                    {locConstants.tableDesigner.backToPreview}
                </Button>
                {getDialogCloseButton()}
            </DialogActions>
        </>
    );

    const publishingSuccessDialogContents = () => (
        <>
            <DialogContent className={classes.dialogContent}>
                <div>{locConstants.tableDesigner.changesPublishedSuccessfully}</div>
            </DialogContent>
            <DialogActions>
                <Button size="medium" appearance="primary" onClick={designerContext.closeDesigner}>
                    {locConstants.tableDesigner.closeDesigner}
                </Button>
                <DialogTrigger action="close">
                    <Button
                        size="medium"
                        appearance="secondary"
                        onClick={() => {
                            setIsConfirmationChecked(false);
                            designerContext.continueEditing;
                        }}>
                        {locConstants.tableDesigner.continueEditing}
                    </Button>
                </DialogTrigger>
            </DialogActions>
        </>
    );

    const previewLoadingDialogContents = () => (
        <>
            <DialogContent className={classes.dialogContent}>
                <Spinner
                    label={locConstants.tableDesigner.loadingPreviewReport}
                    labelPosition="below"
                />
            </DialogContent>
        </>
    );

    const previewLoadingErrorDialogContents = () => (
        <>
            <DialogContent className={classes.dialogContent}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <div>
                    {designerContext.state.generatePreviewReportResult?.schemaValidationError ??
                        locConstants.tableDesigner.errorLoadingPreview}
                </div>
            </DialogContent>
            <DialogActions>
                <DialogTrigger action="close">
                    <Button className={classes.dialogFooterButtons}>
                        {locConstants.common.close}
                    </Button>
                </DialogTrigger>
                <Button
                    className={classes.dialogFooterButtons}
                    onClick={() => {
                        designerContext.generatePreviewReport();
                    }}>
                    {locConstants.tableDesigner.retry}
                </Button>
            </DialogActions>
        </>
    );

    const previewLoadedSuccessDialogContents = () => {
        return (
            <>
                <DialogContent>
                    <div className={classes.markdownContainer}>
                        <ReactMarkdown>{state?.generatePreviewReportResult?.report}</ReactMarkdown>
                    </div>
                    <Checkbox
                        label={locConstants.tableDesigner.designerPreviewConfirmation}
                        required
                        checked={isConfirmationChecked}
                        onChange={(_event, data) => {
                            setIsConfirmationChecked(data.checked as boolean);
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
                </DialogContent>
                <DialogActions>
                    {getDialogCloseButton()}
                    <DialogTrigger action="close">
                        <Button
                            icon={generateScriptIcon()}
                            iconPosition="after"
                            className={classes.openScript}
                            disabled={state.apiState?.previewState !== LoadState.Loaded}
                            appearance="secondary"
                            onClick={designerContext.generateScript}>
                            {locConstants.tableDesigner.generateScript}
                        </Button>
                    </DialogTrigger>
                    <Button
                        className={classes.updateDatabase}
                        disabled={!isConfirmationChecked}
                        title={
                            !isConfirmationChecked
                                ? locConstants.tableDesigner.youMustReviewAndAccept
                                : locConstants.tableDesigner.updateDatabase
                        }
                        appearance="primary"
                        onClick={() => {
                            designerContext.publishChanges();
                        }}>
                        {locConstants.tableDesigner.updateDatabase}
                    </Button>
                </DialogActions>
            </>
        );
    };

    const getDialogContent = () => {
        if (state?.apiState?.publishState === LoadState.Loading) {
            return publishingLoadingDialogContents();
        }
        if (state?.apiState?.publishState === LoadState.Loaded) {
            return publishingSuccessDialogContents();
        }
        if (state?.apiState?.publishState === LoadState.Error) {
            return publishingErrorDialogContents();
        }
        if (state?.apiState?.previewState === LoadState.Loading) {
            return previewLoadingDialogContents();
        }
        if (state?.apiState?.previewState === LoadState.Error) {
            return previewLoadingErrorDialogContents();
        }
        if (state?.apiState?.previewState === LoadState.Loaded) {
            return previewLoadedSuccessDialogContents();
        }
    };

    return (
        <Dialog inertTrapFocus>
            <DialogTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={locConstants.tableDesigner.publish}
                    title={locConstants.tableDesigner.publish}
                    icon={<DatabaseArrowUp16Regular />}
                    onClick={() => {
                        designerContext.generatePreviewReport();
                    }}
                    disabled={(state?.issues?.length ?? 0) > 0}>
                    {locConstants.tableDesigner.publish}
                </Button>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{locConstants.tableDesigner.previewDatabaseUpdates}</DialogTitle>
                    {getDialogContent()}
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
