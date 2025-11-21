/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageBarIntent } from "@fluentui/react-components";

export interface DialogMessageSpec {
  message: string;
  intent?: MessageBarIntent;
  buttons?: DialogMessageButtonSpec[];
}

export interface DialogMessageButtonSpec {
  label: string;
  id: string;
}
