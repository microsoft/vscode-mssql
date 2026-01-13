/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import { locConstants } from "../../common/locConstants";
import { BackupDatabaseContext } from "./backupDatabaseStateProvider";
import {
    BackupDatabaseFormItemSpec,
    BackupDatabaseFormState,
    BackupDatabaseProvider,
    BackupDatabaseState,
} from "../../../sharedInterfaces/objectManagement";
import { FileBrowserDialog } from "../FileBrowser/FileBrowserDialog";
import { FileBrowserProvider } from "../../../sharedInterfaces/fileBrowser";
import { Image, Text } from "@fluentui/react-components";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { AdvancedOptionsDrawer } from "./backupAdvancedOptions";

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
    button: {
        height: "32px",
        width: "160px",
    },
    advancedOptionsDiv: {
        marginLeft: "24px",
    },
    bottomDiv: {
        bottom: 0,
        paddingBottom: "50px",
    },
    formDiv: {
        flexGrow: 1,
    },
    buttonContent: {
        display: "flex",
        flexDirection: "row",
        gap: "0.5rem",
    },
    header: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
    },
});

const databaseIconLight = require("../../../../media/database_light.svg");
const databaseIconDark = require("../../../../media/database_dark.svg");

export const BackupDatabaseForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);

    const state = context?.state;

    if (!context || !state) {
        return;
    }

    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const { formComponents } = state;

    const renderFormFields = () =>
        Object.values(formComponents)
            .filter(
                (component): component is BackupDatabaseFormItemSpec => !component.isAdvancedOption,
            )
            .map((component, index) => (
                <div
                    key={index}
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
                        BackupDatabaseFormState,
                        BackupDatabaseState,
                        BackupDatabaseFormItemSpec,
                        BackupDatabaseProvider
                    >
                        context={context}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const handleSubmit = async () => {
        await context.backupDatabase();
    };

    return (
        <div>
            <div className={classes.outerDiv}>
                <div className={classes.formDiv}>
                    <div className={classes.header}>
                        <Image
                            style={{
                                padding: "10px",
                            }}
                            src={
                                context?.themeKind === ColorThemeKind.Light
                                    ? databaseIconLight
                                    : databaseIconDark
                            }
                            alt={`${locConstants.backupDatabase.backup} - ${context.state.databaseNode.label}`}
                            height={60}
                            width={60}
                        />
                        <Text
                            size={500}
                            style={{
                                lineHeight: "60px",
                            }}
                            weight="medium">
                            {`${locConstants.backupDatabase.backup} - ${context.state.databaseNode.label}`}
                        </Text>
                    </div>
                    {state.dialog?.type === "fileBrowser" && state.fileBrowserState && (
                        <FileBrowserDialog
                            state={state.fileBrowserState}
                            provider={context as FileBrowserProvider}
                            fileTypeOptions={state.fileFilterOptions}
                            closeDialog={() => context.toggleFileBrowserDialog(false)}
                        />
                    )}
                    {renderFormFields()}
                </div>
                <AdvancedOptionsDrawer
                    isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                    setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
                />
                <div className={classes.bottomDiv}>
                    <hr style={{ background: tokens.colorNeutralBackground2 }} />
                    <Button
                        onClick={(_event) => {
                            setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                        }}>
                        {locConstants.backupDatabase.advanced}
                    </Button>
                    <Button
                        className={classes.button}
                        type="submit"
                        onClick={() => handleSubmit()}
                        appearance="primary">
                        {locConstants.backupDatabase.backup}
                    </Button>
                    <Button
                        className={classes.button}
                        type="submit"
                        onClick={() => context.openBackupScript()}
                        appearance="primary">
                        {locConstants.backupDatabase.script}
                    </Button>
                    <Button
                        className={classes.button}
                        type="submit"
                        onClick={() => context.toggleFileBrowserDialog(true)}
                        appearance="primary">
                        Browse Files
                    </Button>
                </div>
            </div>
        </div>
    );
};
