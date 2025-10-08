/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { useContext, useState, useEffect } from "react";
import { useFormStyles } from "../../../common/forms/form.component";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import type { PublishProjectProvider } from "../../../../sharedInterfaces/publishDialog";
import { FormItemType } from "../../../../sharedInterfaces/form";
import { renderInput } from "./FormFieldComponents";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "8px",
        maxWidth: "640px",
        width: "100%",
    },
    buttons: {
        display: "flex",
        flexDirection: "row",
        gap: "4px",
        paddingBottom: "4px",
        alignSelf: "flex-end",
    },
    fieldContainer: {
        flexGrow: 1,
        minWidth: 0,
    },
});

// Publish profile name input with action buttons (select & save) rendered inline via selectors.
export const PublishProfileField: React.FC = () => {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext) as PublishProjectProvider | undefined;
    const component = usePublishDialogSelector((s) => s.formComponents.publishProfilePath);
    const value = usePublishDialogSelector((s) => s.formState.publishProfilePath);
    const [localValue, setLocalValue] = useState(value || "");

    useEffect(() => setLocalValue(value || ""), [value]);

    if (!context || !component || component.hidden) {
        return undefined;
    }
    if (component.type !== FormItemType.Input) {
        return undefined;
    }

    return (
        <div className={`${formStyles.formComponentDiv} ${classes.root}`}>
            <div className={classes.fieldContainer}>
                {renderInput(component, localValue, setLocalValue, { readOnly: true })}
            </div>
            <div className={classes.buttons}>
                <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => context.selectPublishProfile?.()}>
                    {loc.SelectPublishProfile}
                </Button>
                <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => {
                        const publishProfileName = localValue;
                        if (publishProfileName && publishProfileName.trim() !== "") {
                            context.savePublishProfile?.(publishProfileName);
                        }
                    }}>
                    {loc.SaveAs}
                </Button>
            </div>
        </div>
    );
};
