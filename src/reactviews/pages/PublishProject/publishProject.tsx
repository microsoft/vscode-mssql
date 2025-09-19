/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { PublishProjectStateProvider, PublishProjectContext } from "./publishProjectStateProvider";
import { LocConstants } from "../../common/locConstants";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogWebviewState,
} from "../../../sharedInterfaces/publishDialog";
import { FormContextProps } from "../../../sharedInterfaces/form";
import PublishProfileField from "./components/PublishProfile";
import PublishTargetField from "./components/PublishTarget";

const useStyles = makeStyles({
    root: { padding: "12px" },
    footer: {
        marginTop: "8px",
        display: "flex",
        justifyContent: "flex-end",
        gap: "12px",
        alignItems: "center",
        maxWidth: "640px",
        width: "100%",
        paddingTop: "12px",
        borderTop: "1px solid transparent",
    },
});

type PublishFormContext = FormContextProps<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec
> & {
    publishNow: () => void;
    generatePublishScript: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
};

function PublishProjectInner() {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext) as PublishFormContext | undefined;

    if (!context || !context.state) {
        return <div className={classes.root}>Loading...</div>;
    }

    const state = context.state;

    // Static list of main publish dialog options
    const mainOptions: (keyof IPublishForm)[] = ["profileName", "serverName", "databaseName"];

    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    {/* Publish Target (with container extension) */}
                    <PublishTargetField idx={0} />
                    {mainOptions.map((optionName, idx) => {
                        const actualIdx = idx + 1;
                        if (!optionName) {
                            return undefined;
                        }

                        // Special case: publish profile field with its own custom component
                        if ((optionName as string) === "profileName") {
                            return <PublishProfileField key={String(optionName)} idx={actualIdx} />;
                        }

                        // Dynamic form components
                        const component = state.formComponents[
                            optionName as keyof IPublishForm
                        ] as PublishDialogFormItemSpec;
                        if (!component || component.hidden === true) {
                            return undefined;
                        }

                        // Render the field
                        return (
                            <FormField<
                                IPublishForm,
                                PublishDialogWebviewState,
                                PublishDialogFormItemSpec,
                                PublishFormContext
                            >
                                key={String(optionName)}
                                context={context}
                                component={component}
                                idx={actualIdx}
                                props={{ orientation: "horizontal" }}
                            />
                        );
                    })}

                    <div className={classes.footer}>
                        <Button
                            appearance="secondary"
                            onClick={() => context.generatePublishScript()}>
                            {loc.generateScript}
                        </Button>
                        <Button appearance="primary" onClick={() => context.publishNow()}>
                            {loc.publish}
                        </Button>
                    </div>
                </div>
            </div>
        </form>
    );
}

export default function PublishProjectPageWrapper() {
    return (
        <PublishProjectStateProvider>
            <PublishProjectInner />
        </PublishProjectStateProvider>
    );
}
