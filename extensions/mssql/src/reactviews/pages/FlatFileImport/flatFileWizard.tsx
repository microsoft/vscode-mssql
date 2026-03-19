/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import { Button, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileFormPage } from "./flatFileFormPage";
import { ColumnChanges, FlatFileStepType } from "../../../sharedInterfaces/flatFileImport";
import { FlatFileColumnSettingsPage } from "./flatFileColumnSettingsPage";
import { FlatFilePreviewTablePage } from "./flatFilePreviewTablePage";
import { FlatFileSummaryPage } from "./flatFileSummaryPage";
import { useFlatFileSelector } from "./flatFileSelector";
import { FlatFileImportIcon } from "../../common/icons/flatFileImport";
import { Wizard, WizardPageDefinition } from "../../common/wizard";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
});

export const FlatFileWizard = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const [columnChanges, setColumnChanges] = useState<ColumnChanges[]>([]);

    if (!context) return null;

    const loadState = useFlatFileSelector((s) => s.loadState) ?? ApiStatus.Loading;
    const errorMessage = useFlatFileSelector((s) => s.errorMessage);
    const formState = useFlatFileSelector((s) => s.formState);
    const formErrors = useFlatFileSelector((s) => s.formErrors);
    const importDataStatus = useFlatFileSelector((s) => s.importDataStatus);

    const canContinueFromForm =
        formErrors.length === 0 &&
        Boolean(formState.databaseName.trim()) &&
        Boolean(formState.flatFilePath.trim()) &&
        Boolean(formState.tableName.trim()) &&
        Boolean(formState.tableSchema.trim());

    const pages = useMemo<WizardPageDefinition[]>(
        () => [
            {
                id: FlatFileStepType.Form,
                title: locConstants.flatFileImport.stepOne,
                render: () => <FlatFileFormPage />,
                isPageValid: canContinueFromForm,
                onNext: async () => {
                    setColumnChanges([]);
                    context.getTablePreview(
                        formState.flatFilePath,
                        formState.tableName,
                        formState.tableSchema,
                    );
                },
            },
            {
                id: FlatFileStepType.TablePreview,
                title: locConstants.flatFileImport.stepTwo,
                render: () => <FlatFilePreviewTablePage />,
                onPrevious: async () => {
                    setColumnChanges([]);
                    context.resetState(FlatFileStepType.TablePreview);
                },
            },
            {
                id: FlatFileStepType.ColumnChanges,
                title: locConstants.flatFileImport.stepThree,
                render: () => (
                    <FlatFileColumnSettingsPage
                        initialColumnChanges={columnChanges}
                        onColumnChangesChanged={setColumnChanges}
                    />
                ),
                nextLabel: locConstants.flatFileImport.importData,
                onNext: async () => {
                    context.setColumnChanges(columnChanges);
                },
                onPrevious: async () => {
                    setColumnChanges([]);
                    context.resetState(FlatFileStepType.ColumnChanges);
                },
            },
            {
                id: FlatFileStepType.ImportData,
                title: locConstants.flatFileImport.stepFour,
                render: () => <FlatFileSummaryPage />,
                nextLabel: locConstants.common.finish,
                isPageValid: importDataStatus === ApiStatus.Loaded,
                canGoBack: importDataStatus !== ApiStatus.Loaded,
                onNext: async () => {
                    context.dispose();
                    return false;
                },
                onPrevious: async () => {
                    if (importDataStatus !== ApiStatus.Loaded) {
                        context.resetState(FlatFileStepType.ImportData);
                    }
                },
                extraFooterActions: (pageContext) => (
                    <Button
                        appearance="secondary"
                        onClick={() => {
                            setColumnChanges([]);
                            context.resetState(FlatFileStepType.Form);
                            pageContext.goToPage(FlatFileStepType.Form);
                        }}>
                        {locConstants.flatFileImport.importNewFile}
                    </Button>
                ),
            },
        ],
        [canContinueFromForm, columnChanges, context, formState, importDataStatus],
    );

    if (loadState === ApiStatus.Loading) {
        return (
            <div className={classes.outerDiv}>
                <div className={classes.spinnerDiv}>
                    <Spinner
                        label={locConstants.flatFileImport.loadingFlatFileImport}
                        labelPosition="below"
                    />
                </div>
            </div>
        );
    }

    if (loadState === ApiStatus.Error) {
        return (
            <div className={classes.outerDiv}>
                <div className={classes.spinnerDiv}>
                    <ErrorCircleRegular className={classes.errorIcon} />
                    <Text size={400}>{errorMessage ?? ""}</Text>
                </div>
            </div>
        );
    }

    return (
        <Wizard
            icon={<FlatFileImportIcon />}
            title={locConstants.flatFileImport.importFile}
            pages={pages}
            initialPageId={FlatFileStepType.Form}
            onCancel={() => context.dispose()}
        />
    );
};
