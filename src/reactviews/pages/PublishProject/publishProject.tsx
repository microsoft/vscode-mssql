/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { PublishProjectStateProvider, PublishProjectContext } from "./publishProjectStateProvider";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogState,
} from "../../../sharedInterfaces/publishDialog";
import { FormContextProps } from "../../../sharedInterfaces/form";
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";

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
    PublishDialogState,
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
    // Select pieces of state needed for this component
    const formComponents = usePublishDialogSelector((s) => s.formComponents, Object.is);
    const formState = usePublishDialogSelector((s) => s.formState, Object.is);

    const loading = !context || !formComponents || !formState;
    if (loading) {
        return <div className={classes.root}>Loading...</div>;
    }

    // Static ordering now expressed via explicit section components.

    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    <PublishTargetSection idx={0} />
                    <PublishProfileField idx={1} />
                    <ConnectionSection startIdx={2} />

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
