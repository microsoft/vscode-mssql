/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import { cloneElement, ReactElement, useState } from "react";
import * as mssql from "vscode-mssql";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { PublishDialogFrame, PublishDialogReport } from "../../../common/publishDialog";
import {
    getSchemaCompareApplySummarySections,
    getSchemaCompareApplyTargetName,
} from "./schemaCompareApplyDialogUtils";

interface SchemaCompareApplyDialogProps {
    children: ReactElement<{
        disabled?: boolean;
        onClick?: () => void;
    }>;
    targetEndpoint: mssql.SchemaCompareEndpointInfo;
    differences: mssql.DiffEntry[];
    onApply: () => void;
    disabled: boolean;
}

export function SchemaCompareApplyDialog({
    children,
    targetEndpoint,
    differences,
    onApply,
    disabled,
}: SchemaCompareApplyDialogProps) {
    const [open, setOpen] = useState(false);
    const [isConfirmationChecked, setIsConfirmationChecked] = useState(false);

    const closeDialog = () => {
        setOpen(false);
        setIsConfirmationChecked(false);
    };

    const sectionLabels: Record<SchemaUpdateAction, (count: number) => string> = {
        [SchemaUpdateAction.Add]: loc.schemaCompare.createChangesSummary,
        [SchemaUpdateAction.Change]: loc.schemaCompare.changeChangesSummary,
        [SchemaUpdateAction.Delete]: loc.schemaCompare.dropChangesSummary,
    };

    const summaryMarkdown = getSchemaCompareApplySummarySections(differences)
        .map(
            (section) =>
                `## ${sectionLabels[section.action](section.totalCount)}\n\n${section.typeCounts
                    .map(
                        ({ objectType, count }) =>
                            `- ${loc.schemaCompare.objectTypeChangeCount(objectType, count)}`,
                    )
                    .join("\n")}`,
        )
        .join("\n\n");

    return (
        <PublishDialogFrame
            trigger={cloneElement(children, {
                disabled,
                onClick: () => setOpen(true),
            })}
            open={open}
            inertTrapFocus
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    closeDialog();
                }
            }}
            title={loc.schemaCompare.applyChangesTitle(
                getSchemaCompareApplyTargetName(targetEndpoint),
            )}
            content={
                <PublishDialogReport
                    markdown={summaryMarkdown}
                    confirmationLabel={loc.tableDesigner.designerPreviewConfirmation}
                    confirmationChecked={isConfirmationChecked}
                    onConfirmationChange={setIsConfirmationChecked}
                />
            }
            actions={
                <>
                    <Button appearance="secondary" onClick={closeDialog}>
                        {loc.common.cancel}
                    </Button>
                    <Button
                        appearance="primary"
                        disabled={!isConfirmationChecked}
                        onClick={() => {
                            closeDialog();
                            onApply();
                        }}>
                        {loc.schemaCompare.apply}
                    </Button>
                </>
            }
        />
    );
}
