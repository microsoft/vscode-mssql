/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Field, Text, makeStyles } from "@fluentui/react-components";
import { Fragment, useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../common/locConstants";
import {
    AzureIcon20,
    CodeDefinitionIcon16Regular,
    FabricIcon20,
} from "../../common/icons/fluentIcons";

const useStyles = makeStyles({
    loadActions: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    loadActionsLabel: {
        whiteSpace: "nowrap",
    },
    loadActionButton: {
        whiteSpace: "nowrap",
    },
    loadActionIcon: {
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
});

export const ConnectionFormPage = () => {
    const context = useContext(ConnectionDialogContext);
    const mainOptions = useConnectionDialogSelector((s) => s.connectionComponents.mainOptions);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const formState = useConnectionDialogSelector((s) => s.formState);
    const formStyles = useFormStyles();
    const styles = useStyles();

    if (context === undefined) {
        return undefined;
    }

    return (
        <div>
            {mainOptions.map((inputName, idx) => {
                const component = formComponents[inputName as keyof IConnectionDialogProfile];
                if (component?.hidden !== false) {
                    return undefined;
                }

                return (
                    <Fragment key={String(inputName)}>
                        <FormField<
                            IConnectionDialogProfile,
                            ConnectionDialogWebviewState,
                            ConnectionDialogFormItemSpec,
                            ConnectionDialogContextProps
                        >
                            context={context}
                            formState={formState}
                            component={component}
                            idx={idx}
                            props={{ orientation: "horizontal" }}
                        />

                        {inputName === "server" && (
                            <div className={formStyles.formComponentDiv}>
                                <Field label=" " orientation="horizontal">
                                    <div className={styles.loadActions}>
                                        <Text className={styles.loadActionsLabel}>
                                            {locConstants.connectionDialog.loadFrom}:
                                        </Text>
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="secondary"
                                            className={styles.loadActionButton}
                                            icon={<AzureIcon20 className={styles.loadActionIcon} />}
                                            onClick={() => {
                                                context.openBrowseDialog(
                                                    ConnectionInputMode.AzureBrowse,
                                                );
                                            }}>
                                            {locConstants.connectionDialog.azure}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="secondary"
                                            className={styles.loadActionButton}
                                            icon={
                                                <FabricIcon20 className={styles.loadActionIcon} />
                                            }
                                            onClick={() => {
                                                context.openBrowseDialog(
                                                    ConnectionInputMode.FabricBrowse,
                                                );
                                            }}>
                                            {locConstants.connectionDialog.fabric}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="secondary"
                                            className={styles.loadActionButton}
                                            icon={
                                                <CodeDefinitionIcon16Regular
                                                    className={styles.loadActionIcon}
                                                />
                                            }
                                            onClick={() => {
                                                context.openConnectionStringDialog();
                                            }}>
                                            {locConstants.connectionDialog.connectionString}
                                        </Button>
                                    </div>
                                </Field>
                            </div>
                        )}
                    </Fragment>
                );
            })}
        </div>
    );
};
