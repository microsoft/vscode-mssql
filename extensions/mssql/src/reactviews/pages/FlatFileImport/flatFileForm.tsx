/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, Dropdown, Field, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import { FlatFileContext } from "./flatFileStateProvider";
import {
    FlatFileImportFormItemSpec,
    FlatFileImportFormState,
    FlatFileImportProvider,
    FlatFileImportState,
    FlatFileStepType,
} from "../../../sharedInterfaces/flatFileImport";
import { locConstants } from "../../common/locConstants";
import { FlatFileHeader } from "./flatFileHeader";
import { ApiStatus } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "5px",
        marginRight: "5px",
        padding: "8px",
        width: "500px",
        whiteSpace: "nowrap",
        minWidth: "800px",
        height: "80vh",
    },
    formDiv: {
        width: "500px",
        display: "flex",
        flexDirection: "column",
    },
    formLoadingLabel: {
        display: "flex",
        alignItems: "center",
        marginTop: 0,
        marginBottom: 0,
    },
    button: {
        height: "30px",
        width: "100px",
        margin: "5px",
    },
    bottomDiv: {
        paddingTop: "20px",
        paddingBottom: "50px",
    },
    buttonContent: {
        paddingTop: "8px",
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
});

export const FlatFileForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

    if (!context || !state) return;

    const { formComponents } = context.state;
    const schemaFormComponent = formComponents["tableSchema"] as FlatFileImportFormItemSpec;

    const handleSubmit = async () => {
        context.getTablePreview(
            state.formState.flatFilePath,
            state.formState.tableName,
            state.formState.tableSchema,
        );
        context.setStep(FlatFileStepType.TablePreview);
    };

    const shouldDisableNext = (): boolean => {
        return (
            state.formErrors.length > 0 ||
            !state.formState.databaseName.trim() ||
            !state.formState.flatFilePath.trim() ||
            !state.formState.tableName.trim() ||
            !state.formState.tableSchema.trim()
        );
    };

    return (
        <div>
            <FlatFileHeader
                headerText={locConstants.flatFileImport.importFile}
                stepText={locConstants.flatFileImport.stepOne}
            />
            <div className={classes.outerDiv}>
                <div className={classes.formDiv}>
                    <FormField<
                        FlatFileImportFormState,
                        FlatFileImportState,
                        FlatFileImportFormItemSpec,
                        FlatFileImportProvider
                    >
                        context={context}
                        component={formComponents["databaseName"] as FlatFileImportFormItemSpec}
                        idx={0}
                    />

                    <FormField<
                        FlatFileImportFormState,
                        FlatFileImportState,
                        FlatFileImportFormItemSpec,
                        FlatFileImportProvider
                    >
                        context={context}
                        component={formComponents["flatFilePath"] as FlatFileImportFormItemSpec}
                        idx={0}
                    />
                    <div>
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => context.openVSCodeFileBrowser()}
                            appearance="secondary"
                            style={{
                                width: "80px",
                                marginLeft: "5px",
                            }}>
                            {locConstants.flatFileImport.browse}
                        </Button>
                    </div>
                    <FormField<
                        FlatFileImportFormState,
                        FlatFileImportState,
                        FlatFileImportFormItemSpec,
                        FlatFileImportProvider
                    >
                        context={context}
                        component={formComponents["tableName"] as FlatFileImportFormItemSpec}
                        idx={0}
                    />
                    {state.schemaLoadStatus === ApiStatus.Loading ? (
                        <div style={{ marginLeft: "6px", marginBottom: "2px" }}>
                            <Field
                                label={
                                    <div className={classes.formLoadingLabel}>
                                        <Text>{schemaFormComponent.label}</Text>
                                        <Spinner
                                            size="extra-tiny"
                                            style={{ transform: "scale(0.8)" }}
                                        />
                                    </div>
                                }>
                                <Dropdown
                                    size="small"
                                    placeholder={schemaFormComponent.placeholder}
                                    style={{
                                        marginTop: 0,
                                        width: "490px",
                                        height: "26px",
                                    }}
                                />
                            </Field>
                        </div>
                    ) : (
                        <FormField<
                            FlatFileImportFormState,
                            FlatFileImportState,
                            FlatFileImportFormItemSpec,
                            FlatFileImportProvider
                        >
                            context={context}
                            component={schemaFormComponent}
                            idx={0}
                        />
                    )}
                </div>
                <div className={classes.bottomDiv}>
                    <Button
                        className={classes.button}
                        type="submit"
                        onClick={() => handleSubmit()}
                        appearance="primary"
                        disabled={shouldDisableNext()}>
                        {locConstants.common.next}
                    </Button>
                    <Button
                        className={classes.button}
                        type="submit"
                        onClick={() => context.dispose()}
                        appearance="secondary">
                        {locConstants.common.cancel}
                    </Button>
                </div>
            </div>
        </div>
    );
};
