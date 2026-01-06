/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
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
});

export const BackupDatabaseForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);

    const state = context?.state;

    if (!context || !state) {
        return;
    }
    const { formComponents } = state;

    const renderFormFields = () =>
        Object.values(formComponents).map((component, index) => (
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
                <div className={classes.formDiv}>{renderFormFields()}</div>
                <div className={classes.bottomDiv}>
                    <hr style={{ background: tokens.colorNeutralBackground2 }} />
                    <Button
                        className={classes.button}
                        type="submit"
                        onClick={() => handleSubmit()}
                        appearance="primary">
                        {locConstants.backupDatabase.backup}
                    </Button>
                </div>
            </div>
        </div>
    );
};
