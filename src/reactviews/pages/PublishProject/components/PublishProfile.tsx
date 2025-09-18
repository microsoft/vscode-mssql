/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import { FormField, useFormStyles } from "../../../common/forms/form.component";
import { LocConstants } from "../../../common/locConstants";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogWebviewState,
} from "../../../../sharedInterfaces/publishDialog";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { FormContextProps } from "../../../../sharedInterfaces/form";

/**
 * Extended context type including the extra publish profile actions we expose.
 */
type PublishFormContext = FormContextProps<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec
> & {
    selectPublishProfile?: () => void;
    savePublishProfile?: (profilePathOrFileName?: string) => void;
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

/**
 * Custom field wrapper for Publish Profile.
 * Renders the generic FormField for the text input and adds the action buttons alongside it.
 */
export default function PublishProfileField(props: { idx: number }) {
    const { idx } = props;
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext) as PublishFormContext | undefined;

    if (!context || !context.state) {
        return undefined;
    }

    const component = context.state.formComponents.profilePath as PublishDialogFormItemSpec;

    return (
        <div className={`${formStyles.formComponentDiv} ${classes.root}`}>
            <div className={classes.fieldContainer}>
                <FormField<
                    IPublishForm,
                    PublishDialogWebviewState,
                    PublishDialogFormItemSpec,
                    PublishFormContext
                >
                    context={context}
                    component={component}
                    idx={idx}
                    props={{ orientation: "horizontal" }}
                />
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
                        const profilePath = context.state.formState.profilePath;
                        if (profilePath && profilePath.trim() !== "") {
                            context.savePublishProfile?.();
                        }
                    }}>
                    {loc.SaveAs}
                </Button>
            </div>
        </div>
    );
}
