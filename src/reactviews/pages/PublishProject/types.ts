/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormContextProps } from "../../../sharedInterfaces/form";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogState,
} from "../../../sharedInterfaces/publishDialog";

/**
 * Extended context type used across all publish project components.
 * Combines the base form context with publish-specific actions.
 */
export interface PublishFormContext
    extends FormContextProps<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {
    publishNow: () => void;
    generatePublishScript: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
}
