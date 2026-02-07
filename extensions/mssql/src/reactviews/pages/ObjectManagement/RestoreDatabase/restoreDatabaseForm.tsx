/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    RestoreDatabaseContext,
    RestoreDatabaseContextProps,
} from "./restoreDatabaseStateProvider";
import { FormField, useFormStyles } from "../../../common/forms/form.component";
import {
    RestoreDatabaseFormState,
    RestoreDatabaseViewModel,
    RestoreType,
} from "../../../../sharedInterfaces/restore";
import {
    ObjectManagementFormItemSpec,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../../common/locConstants";
import { Field, Image, makeStyles, Radio, RadioGroup, Text } from "@fluentui/react-components";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { AzureIcon20 } from "../../../common/icons/fluentIcons";
import { Database20Regular, DocumentDatabase20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "5px",
        marginRight: "5px",
        padding: "8px",
        whiteSpace: "nowrap",
        width: "650px",
        overflow: "auto",
    },
    button: {
        height: "32px",
        width: "120px",
    },
    bottomDiv: {
        marginTop: "auto",
        paddingBottom: "50px",
    },
    header: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
    },
    saveOption: {
        display: "flex",
        alignItems: "center",
    },
    fileDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "0px",
    },
    fileButtons: {
        display: "flex",
        flexDirection: "row",
        gap: "8px",
        marginLeft: "10px",
    },
    advancedButtonDiv: {
        display: "flex",
        alignItems: "center",
        marginTop: "20px",
    },
    icon: {
        width: "75px",
        height: "75px",
        marginBottom: "10px",
    },
    azureLoadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
    },
    formLoadingLabel: {
        display: "flex",
        alignItems: "center",
        marginTop: 0,
        marginBottom: 0,
    },
    fileList: {
        display: "flex",
        flexDirection: "column",
        padding: "10px",
        gap: "8px",
    },
    field: {
        width: "400px",
    },
});

const restoreLightIcon = require("../../../../../media/restore_light.svg");
const restoreDarkIcon = require("../../../../../media/restore_dark.svg");

export const RestoreDatabaseForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(RestoreDatabaseContext);
    const state = context?.state;

    if (!context || !state) {
        return null;
    }

    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;

    const [restoreType, setRestoreType] = useState<RestoreType>(restoreViewModel.restoreType);

    const formStyles = useFormStyles();
    const formComponents = state.formComponents;

    const renderFormFields = () =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    !component.groupName || component.groupName === restoreViewModel.restoreType,
            )
            .map((component, index) => (
                <div
                    key={index}
                    className={formStyles.formComponentDiv}
                    style={
                        component.componentWidth
                            ? {
                                  width: component.componentWidth,
                                  maxWidth: component.componentWidth,
                                  whiteSpace: "normal", // allows wrapping
                                  overflowWrap: "break-word", // breaks long words if needed
                                  wordBreak: "break-word",
                              }
                            : {}
                    }>
                    <FormField<
                        RestoreDatabaseFormState,
                        ObjectManagementWebviewState<RestoreDatabaseFormState>,
                        ObjectManagementFormItemSpec<RestoreDatabaseFormState>,
                        RestoreDatabaseContextProps
                    >
                        context={context}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    return (
        <div className={classes.outerDiv}>
            <div className={classes.header}>
                <Image
                    style={{
                        padding: "10px",
                    }}
                    src={
                        context.themeKind === ColorThemeKind.Dark
                            ? restoreDarkIcon
                            : restoreLightIcon
                    }
                    alt={`${locConstants.restoreDatabase.restoreDatabase} - ${restoreViewModel.serverName}`}
                    height={60}
                    width={60}
                />
                <Text
                    size={500}
                    style={{
                        lineHeight: "60px",
                    }}
                    weight="medium">
                    {`${locConstants.restoreDatabase.restore} - ${restoreViewModel.serverName}`}
                </Text>
            </div>
            <div className={formStyles.formComponentDiv} style={{ marginLeft: "5px" }}>
                <Field
                    label={locConstants.backupDatabase.backupLocation}
                    className={classes.field}
                    orientation="horizontal">
                    <RadioGroup
                        onChange={(_, data) => {
                            const selectedRestoreType = data.value as RestoreType;
                            context.setRestoreType(selectedRestoreType);
                            setRestoreType(selectedRestoreType);
                            if (selectedRestoreType === RestoreType.Url) {
                                context.loadAzureComponent("accountId");
                            }
                        }}
                        value={restoreType}>
                        <Radio
                            value={RestoreType.Database}
                            label={
                                <div className={classes.saveOption}>
                                    <Database20Regular style={{ marginRight: "8px" }} />
                                    {locConstants.restoreDatabase.database}
                                </div>
                            }
                        />
                        <Radio
                            value={RestoreType.BackupFile}
                            label={
                                <div className={classes.saveOption}>
                                    <DocumentDatabase20Regular style={{ marginRight: "8px" }} />
                                    {locConstants.restoreDatabase.backupFile}
                                </div>
                            }
                        />
                        <Radio
                            value={RestoreType.Url}
                            label={
                                <div className={classes.saveOption}>
                                    <AzureIcon20 style={{ marginRight: "8px" }} />
                                    {locConstants.restoreDatabase.url}
                                </div>
                            }
                        />
                    </RadioGroup>
                </Field>
            </div>
            {renderFormFields()}
        </div>
    );
};
