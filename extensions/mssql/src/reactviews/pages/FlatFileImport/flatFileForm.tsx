/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, Dropdown, Field, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import { FlatFileContext, FlatFileContextProps } from "./flatFileStateProvider";
import {
    FlatFileImportFormItemSpec,
    FlatFileImportFormState,
    FlatFileImportState,
} from "../../../sharedInterfaces/flatFileImport";
import { locConstants } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { useFlatFileSelector } from "./flatFileSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
    },
    formDiv: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: "560px",
        minWidth: 0,
    },
    formLoadingLabel: {
        display: "flex",
        alignItems: "center",
        marginTop: 0,
        marginBottom: 0,
    },
    browseButton: {
        height: "30px",
        width: "80px",
    },
    browseRow: {
        display: "flex",
        gap: "6px",
        margin: "5px",
    },
});

export const FlatFileForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);

    if (!context) return null;

    const formState = useFlatFileSelector((s) => s.formState);
    const formComponents = useFlatFileSelector((s) => s.formComponents);
    const schemaLoadStatus = useFlatFileSelector((s) => s.schemaLoadStatus);

    const schemaFormComponent = formComponents["tableSchema"] as FlatFileImportFormItemSpec;

    return (
        <div className={classes.outerDiv}>
            <div className={classes.formDiv}>
                <FormField<
                    FlatFileImportFormState,
                    FlatFileImportState,
                    FlatFileImportFormItemSpec,
                    FlatFileContextProps
                >
                    context={context}
                    formState={formState}
                    component={formComponents["databaseName"] as FlatFileImportFormItemSpec}
                    idx={0}
                />

                <FormField<
                    FlatFileImportFormState,
                    FlatFileImportState,
                    FlatFileImportFormItemSpec,
                    FlatFileContextProps
                >
                    context={context}
                    formState={formState}
                    component={formComponents["flatFilePath"] as FlatFileImportFormItemSpec}
                    idx={0}
                />
                <div className={classes.browseRow}>
                    <Button
                        className={classes.browseButton}
                        type="submit"
                        onClick={() => context.openVSCodeFileBrowser()}
                        appearance="secondary">
                        {locConstants.flatFileImport.browse}
                    </Button>
                </div>
                <FormField<
                    FlatFileImportFormState,
                    FlatFileImportState,
                    FlatFileImportFormItemSpec,
                    FlatFileContextProps
                >
                    context={context}
                    formState={formState}
                    component={formComponents["tableName"] as FlatFileImportFormItemSpec}
                    idx={0}
                />
                {schemaLoadStatus === ApiStatus.Loading ? (
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
                                    width: "100%",
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
                        FlatFileContextProps
                    >
                        context={context}
                        formState={formState}
                        component={schemaFormComponent}
                        idx={0}
                    />
                )}
            </div>
        </div>
    );
};
