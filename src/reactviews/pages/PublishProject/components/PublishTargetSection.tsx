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
import { FormContextProps } from "../../../../sharedInterfaces/form";

// Context type (mirrors existing usage in page)
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

export const PublishTargetSection: React.FC<{ idx: number }> = ({ idx }) => {
    const context = useContext(PublishProjectContext) as PublishFormContext | undefined;
    const component = usePublishDialogSelector((s) => s.formComponents.publishTarget, Object.is);

    if (!context || !component || component.hidden) {
        return undefined;
    }

    return (
        <FormField<IPublishForm, PublishDialogState, PublishDialogFormItemSpec, PublishFormContext>
            context={context}
            component={component}
            idx={idx}
            props={{ orientation: "horizontal" }}
        />
    );
};
