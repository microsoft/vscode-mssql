/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import { Button, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ArrowLeft20Regular, ArrowRight20Regular, ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileForm } from "./flatFileForm";
import { ColumnChanges, FlatFileStepType } from "../../../sharedInterfaces/flatFileImport";
import { FlatFileColumnSettings } from "./flatFileColumnSettings";
import { FlatFilePreviewTablePage } from "./flatFilePreviewTable";
import { FlatFileSummary } from "./flatFileSummary";
import { useFlatFileSelector } from "./flatFileSelector";
import { WizardPageShell } from "../../common/wizardPageShell";
import { FlatFileImportIcon } from "../../common/icons/flatFileImport";

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
    footer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "8px",
        width: "100%",
        flexWrap: "wrap",
    },
    footerButtonContent: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
    },
});

const totalSteps = 4;

const stripStepPrefix = (label: string) => label.replace(/^Step\s+\d+:\s*/i, "");

export const FlatFileImportPage = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const [columnChanges, setColumnChanges] = useState<ColumnChanges[]>([]);

    if (!context) return null;

    const loadState = useFlatFileSelector((s) => s.loadState) ?? ApiStatus.Loading;
    const currentStep = useFlatFileSelector((s) => s.currentStep);
    const errorMessage = useFlatFileSelector((s) => s.errorMessage);
    const formState = useFlatFileSelector((s) => s.formState);
    const formErrors = useFlatFileSelector((s) => s.formErrors);
    const importDataStatus = useFlatFileSelector((s) => s.importDataStatus);

    const stepNumber = useMemo(() => {
        switch (currentStep) {
            case FlatFileStepType.TablePreview:
                return 2;
            case FlatFileStepType.ColumnChanges:
                return 3;
            case FlatFileStepType.ImportData:
                return 4;
            case FlatFileStepType.Form:
            default:
                return 1;
        }
    }, [currentStep]);

    const stepLabel = useMemo(() => {
        switch (currentStep) {
            case FlatFileStepType.TablePreview:
                return stripStepPrefix(locConstants.flatFileImport.stepTwo);
            case FlatFileStepType.ColumnChanges:
                return stripStepPrefix(locConstants.flatFileImport.stepThree);
            case FlatFileStepType.ImportData:
                return stripStepPrefix(locConstants.flatFileImport.stepFour);
            case FlatFileStepType.Form:
            default:
                return stripStepPrefix(locConstants.flatFileImport.stepOne);
        }
    }, [currentStep]);

    const canContinueFromForm =
        formErrors.length === 0 &&
        Boolean(formState.databaseName.trim()) &&
        Boolean(formState.flatFilePath.trim()) &&
        Boolean(formState.tableName.trim()) &&
        Boolean(formState.tableSchema.trim());

    const handleNext = () => {
        switch (currentStep) {
            case FlatFileStepType.Form:
                setColumnChanges([]);
                context.getTablePreview(
                    formState.flatFilePath,
                    formState.tableName,
                    formState.tableSchema,
                );
                context.setStep(FlatFileStepType.TablePreview);
                return;
            case FlatFileStepType.TablePreview:
                context.setStep(FlatFileStepType.ColumnChanges);
                return;
            case FlatFileStepType.ColumnChanges:
                context.setColumnChanges(columnChanges);
                context.setStep(FlatFileStepType.ImportData);
                return;
            default:
                return;
        }
    };

    const handleBack = () => {
        switch (currentStep) {
            case FlatFileStepType.TablePreview:
                setColumnChanges([]);
                context.resetState(FlatFileStepType.TablePreview);
                return;
            case FlatFileStepType.ColumnChanges:
                setColumnChanges([]);
                context.resetState(FlatFileStepType.ColumnChanges);
                return;
            case FlatFileStepType.ImportData:
                if (importDataStatus !== ApiStatus.Loaded) {
                    context.resetState(FlatFileStepType.ImportData);
                }
                return;
            default:
                return;
        }
    };

    const renderFooter = () => {
        if (loadState !== ApiStatus.Loaded) {
            return null;
        }

        switch (currentStep) {
            case FlatFileStepType.Form:
                return (
                    <div className={classes.footer}>
                        <Button
                            appearance="primary"
                            disabled={!canContinueFromForm}
                            onClick={handleNext}>
                            <span className={classes.footerButtonContent}>
                                <span>{locConstants.common.next}</span>
                                <ArrowRight20Regular />
                            </span>
                        </Button>
                        <Button appearance="secondary" onClick={() => context.dispose()}>
                            {locConstants.common.cancel}
                        </Button>
                    </div>
                );
            case FlatFileStepType.TablePreview:
                return (
                    <div className={classes.footer}>
                        <Button appearance="secondary" onClick={handleBack}>
                            <span className={classes.footerButtonContent}>
                                <ArrowLeft20Regular />
                                <span>{locConstants.common.previous}</span>
                            </span>
                        </Button>
                        <Button appearance="primary" onClick={handleNext}>
                            <span className={classes.footerButtonContent}>
                                <span>{locConstants.common.next}</span>
                                <ArrowRight20Regular />
                            </span>
                        </Button>
                        <Button appearance="secondary" onClick={() => context.dispose()}>
                            {locConstants.common.cancel}
                        </Button>
                    </div>
                );
            case FlatFileStepType.ColumnChanges:
                return (
                    <div className={classes.footer}>
                        <Button appearance="secondary" onClick={handleBack}>
                            <span className={classes.footerButtonContent}>
                                <ArrowLeft20Regular />
                                <span>{locConstants.common.previous}</span>
                            </span>
                        </Button>
                        <Button appearance="primary" onClick={handleNext}>
                            {locConstants.flatFileImport.importData}
                        </Button>
                        <Button appearance="secondary" onClick={() => context.dispose()}>
                            {locConstants.common.cancel}
                        </Button>
                    </div>
                );
            case FlatFileStepType.ImportData:
                return (
                    <div className={classes.footer}>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                setColumnChanges([]);
                                context.resetState(FlatFileStepType.Form);
                            }}>
                            {locConstants.flatFileImport.importNewFile}
                        </Button>
                        <Button
                            appearance="secondary"
                            disabled={importDataStatus === ApiStatus.Loaded}
                            onClick={handleBack}>
                            <span className={classes.footerButtonContent}>
                                <ArrowLeft20Regular />
                                <span>{locConstants.common.previous}</span>
                            </span>
                        </Button>
                        <Button
                            appearance={
                                importDataStatus === ApiStatus.Loaded ? "primary" : "secondary"
                            }
                            onClick={() => context.dispose()}>
                            {importDataStatus === ApiStatus.Loaded
                                ? locConstants.common.finish
                                : locConstants.common.cancel}
                        </Button>
                    </div>
                );
            default:
                return null;
        }
    };

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.flatFileImport.loadingFlatFileImport}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                switch (currentStep) {
                    case FlatFileStepType.TablePreview:
                        return <FlatFilePreviewTablePage />;
                    case FlatFileStepType.ColumnChanges:
                        return (
                            <FlatFileColumnSettings
                                initialColumnChanges={columnChanges}
                                onColumnChangesChanged={setColumnChanges}
                            />
                        );
                    case FlatFileStepType.ImportData:
                        return <FlatFileSummary />;
                    case FlatFileStepType.Form:
                    default:
                        return <FlatFileForm />;
                }
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    if (loadState !== ApiStatus.Loaded) {
        return <div className={classes.outerDiv}>{renderMainContent()}</div>;
    }

    return (
        <WizardPageShell
            icon={<FlatFileImportIcon />}
            title={locConstants.flatFileImport.importFile}
            subtitle={stepLabel}
            currentStep={stepNumber}
            totalSteps={totalSteps}
            footer={renderFooter()}>
            {renderMainContent()}
        </WizardPageShell>
    );
};
