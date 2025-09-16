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
import { PublishAdvancedOptionsDrawer } from "./components/publishAdvancedOptionsDrawer";

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
    openPublishAdvanced: () => void;
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
    const mainOptions: (keyof IPublishForm)[] = [
        "publishTarget",
        "profileName",
        "serverName",
        "databaseName",
    ];

    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    {mainOptions.map((optionName, idx) => {
                        if (!optionName) {
                            return undefined;
                        }

                        if ((optionName as string) === "profileName") {
                            return <PublishProfileField key={String(optionName)} idx={idx} />;
                        }

                        const component = state.formComponents[
                            optionName as keyof IPublishForm
                        ] as PublishDialogFormItemSpec;
                        if (!component || component.hidden === true) {
                            return undefined;
                        }
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
                                idx={idx}
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
