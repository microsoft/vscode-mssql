/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { FormField } from "../../../common/forms/form.component";
import {
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
} from "../../../../sharedInterfaces/publishDialog";
import { PublishFormContext } from "../types";
import * as constants from "../../../../constants/constants";

export const ConnectionSection: React.FC<{ idx: number }> = ({ idx }) => {
    const context = useContext(PublishProjectContext) as PublishFormContext | undefined;

    const serverComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.ServerName],
        Object.is,
    );
    const databaseComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.DatabaseName],
        Object.is,
    );

    if (!context) {
        return undefined;
    }

    return (
        <>
            {serverComponent && !serverComponent.hidden && (
                <FormField<
                    IPublishForm,
                    PublishDialogState,
                    PublishDialogFormItemSpec,
                    PublishFormContext
                >
                    context={context}
                    component={serverComponent}
                    idx={idx}
                    props={{ orientation: "horizontal" }}
                />
            )}
            {databaseComponent && !databaseComponent.hidden && (
                <FormField<
                    IPublishForm,
                    PublishDialogState,
                    PublishDialogFormItemSpec,
                    PublishFormContext
                >
                    context={context}
                    component={databaseComponent}
                    idx={idx + 1}
                    props={{ orientation: "horizontal" }}
                />
            )}
        </>
    );
};
