/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DialogTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Spinner,
} from "@fluentui/react-components";
import {
    CopyRegular,
    DatabaseArrowUp16Regular,
    ErrorCircleRegular,
    CheckmarkCircleFilled,
} from "@fluentui/react-icons";
import { useContext, useState } from "react";

import { Button } from "@fluentui/react-button";
import { LoadState } from "../../../sharedInterfaces/tableDesigner";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useTableDesignerSelector } from "./tableDesignerSelector";
import { locConstants } from "../../common/locConstants";
import { LoadingLog } from "../../common/loadingLog";
import {
    PublishDialogCenteredContent,
    PublishDialogFrame,
    PublishDialogReport,
} from "../../common/publishDialog";

export const DesignerChangesPreviewButton = () => {
    const designerContext = useContext(TableDesignerContext);
    const apiState = useTableDesignerSelector((s) => s?.apiState);
    const publishingError = useTableDesignerSelector((s) => s?.publishingError);
    const reportProgressMessages = useTableDesignerSelector((s) => s?.reportProgressMessages);
    const publishProgressMessages = useTableDesignerSelector((s) => s?.publishProgressMessages);
    const generatePreviewReportResult = useTableDesignerSelector(
        (s) => s?.generatePreviewReportResult,
    );
    const issues = useTableDesignerSelector((s) => s?.issues);
    if (!designerContext) {
        return undefined;
    }

    const [isConfirmationChecked, setIsConfirmationChecked] = useState(false);

    const generateScriptIcon = () => {
        switch (apiState?.generateScriptState) {
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

    const publishingLoadingDialogContent = () => (
        <LoadingLog
            messages={publishProgressMessages ?? []}
            fallbackMessage={locConstants.tableDesigner.publishingChanges}
            minHeight="100%"
        />
    );

    const publishingErrorDialogContent = () => (
        <MessageBar intent="error" style={{ paddingRight: "12px" }}>
            <MessageBarBody
                style={{
                    textAlign: "justify",
                }}>
                {publishingError ?? ""}
            </MessageBarBody>
            <MessageBarActions>
                <Button
                    onClick={() => designerContext.copyPublishErrorToClipboard()}
                    icon={<CopyRegular />}>
                    {locConstants.tableDesigner.copy}
                </Button>
            </MessageBarActions>
        </MessageBar>
    );

    const publishingErrorDialogActions = () => (
        <>
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
        </>
    );

    const publishingSuccessDialogContent = () => (
        <PublishDialogCenteredContent>
            <CheckmarkCircleFilled style={{ width: "50px", height: "50px", marginBottom: 8 }} />
            <div>{locConstants.tableDesigner.changesPublishedSuccessfully}</div>
        </PublishDialogCenteredContent>
    );

    const publishingSuccessDialogActions = () => (
        <>
            <DialogTrigger action="close">
                <Button
                    size="medium"
                    appearance="secondary"
                    onClick={() => {
                        setIsConfirmationChecked(false);
                        designerContext.continueEditing();
                    }}>
                    {locConstants.tableDesigner.continueEditing}
                </Button>
            </DialogTrigger>
            <Button size="medium" appearance="secondary" onClick={designerContext.closeDesigner}>
                {locConstants.common.close}
            </Button>
        </>
    );

    const previewLoadingDialogContent = () => (
        <LoadingLog
            messages={reportProgressMessages ?? []}
            fallbackMessage={locConstants.tableDesigner.loadingPreviewReport}
            minHeight="100%"
        />
    );

    const previewLoadingErrorDialogContent = () => (
        <PublishDialogCenteredContent>
            <ErrorCircleRegular
                style={{
                    fontSize: "100px",
                    opacity: 0.5,
                    color: "var(--vscode-errorForeground)",
                }}
            />
            <div>
                {generatePreviewReportResult?.schemaValidationError ??
                    locConstants.tableDesigner.errorLoadingPreview}
            </div>
        </PublishDialogCenteredContent>
    );

    const previewLoadingErrorDialogActions = () => (
        <>
            <DialogTrigger action="close">
                <Button>{locConstants.common.close}</Button>
            </DialogTrigger>
            <Button
                onClick={() => {
                    designerContext.generatePreviewReport();
                }}>
                {locConstants.tableDesigner.retry}
            </Button>
        </>
    );

    const previewLoadedSuccessDialogContent = () => (
        <PublishDialogReport
            markdown={generatePreviewReportResult?.report ?? ""}
            confirmationLabel={locConstants.publishDialog.confirmationText}
            confirmationChecked={isConfirmationChecked}
            onConfirmationChange={setIsConfirmationChecked}
        />
    );

    const previewLoadedSuccessDialogActions = () => (
        <>
            <Button
                disabled={!isConfirmationChecked}
                title={
                    !isConfirmationChecked
                        ? locConstants.tableDesigner.youMustReviewAndAccept
                        : locConstants.publishDialog.publish
                }
                appearance="primary"
                onClick={() => {
                    designerContext.publishChanges();
                }}>
                {locConstants.publishDialog.publish}
            </Button>
            <DialogTrigger action="close">
                <Button
                    icon={generateScriptIcon()}
                    iconPosition="after"
                    disabled={apiState?.previewState !== LoadState.Loaded}
                    appearance="secondary"
                    onClick={designerContext.generateScript}>
                    {locConstants.publishDialog.openPublishScript}
                </Button>
            </DialogTrigger>
            {getDialogCloseButton()}
        </>
    );

    const getDialogContent = () => {
        if (apiState?.publishState === LoadState.Loading) {
            return publishingLoadingDialogContent();
        }
        if (apiState?.publishState === LoadState.Loaded) {
            return publishingSuccessDialogContent();
        }
        if (apiState?.publishState === LoadState.Error) {
            return publishingErrorDialogContent();
        }
        if (apiState?.previewState === LoadState.Loading) {
            return previewLoadingDialogContent();
        }
        if (apiState?.previewState === LoadState.Error) {
            return previewLoadingErrorDialogContent();
        }
        if (apiState?.previewState === LoadState.Loaded) {
            return previewLoadedSuccessDialogContent();
        }
    };

    const getDialogActions = () => {
        if (apiState?.publishState === LoadState.Loaded) {
            return publishingSuccessDialogActions();
        }
        if (apiState?.publishState === LoadState.Error) {
            return publishingErrorDialogActions();
        }
        if (apiState?.previewState === LoadState.Error) {
            return previewLoadingErrorDialogActions();
        }
        if (apiState?.previewState === LoadState.Loaded) {
            return previewLoadedSuccessDialogActions();
        }
    };

    return (
        <PublishDialogFrame
            inertTrapFocus
            title={locConstants.publishDialog.publishChanges}
            content={getDialogContent()}
            actions={getDialogActions()}
            trigger={
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
                        disabled={(issues?.length ?? 0) > 0}>
                        {locConstants.publishDialog.publishChanges}
                    </Button>
                </DialogTrigger>
            }
        />
    );
};
