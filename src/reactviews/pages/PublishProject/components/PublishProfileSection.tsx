/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Field, Input } from "@fluentui/react-components";
import { useContext, useState, useEffect } from "react";
import { useFormStyles } from "../../../common/forms/form.component";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import type { IPublishForm } from "../../../../sharedInterfaces/publishDialog";
import { FormItemType } from "../../../../sharedInterfaces/form";

/**
 * Extended context type including the extra publish profile actions we expose.
 */
type PublishFormActions = {
    selectPublishProfile?: () => void;
    savePublishProfile?: (profileName: string) => void;
    formAction: (args: {
        propertyName: keyof IPublishForm;
        isAction: boolean;
        value?: unknown;
    }) => void;
};

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
    const context = useContext(PublishProjectContext) as PublishFormActions | undefined;
    const component = usePublishDialogSelector((s) => s.formComponents.profileName);
    const value = usePublishDialogSelector((s) => s.formState.profileName);
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
                <Field
                    key={component.propertyName}
                    required={component.required}
                    label={<span dangerouslySetInnerHTML={{ __html: component.label }} />}
                    validationMessage={component.validation?.validationMessage}
                    validationState={
                        component.validation
                            ? component.validation.isValid
                                ? "none"
                                : "error"
                            : "none"
                    }
                    orientation="horizontal">
                    <Input
                        size="small"
                        value={localValue}
                        placeholder={component.placeholder ?? ""}
                        onChange={(_, data) => {
                            setLocalValue(data.value);
                            context.formAction({
                                propertyName: component.propertyName as keyof IPublishForm,
                                isAction: false,
                                value: data.value,
                            });
                        }}
                    />
                </Field>
            </div>
            <div className={classes.buttons}>
                <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => context.selectPublishProfile?.()}>
                    {loc.SelectProfile}
                </Button>
                <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => {
                        const profileName = localValue;
                        if (profileName && profileName.trim() !== "") {
                            context.savePublishProfile?.(profileName);
                        }
                    }}>
                    {loc.SaveAs}
                </Button>
            </div>
        </div>
    );
};
