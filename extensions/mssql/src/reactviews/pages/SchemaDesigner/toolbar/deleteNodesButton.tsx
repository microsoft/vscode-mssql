/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";

export function DeleteNodesButton() {
  const context = useContext(SchemaDesignerContext);
  return (
    <Button
      size="small"
      appearance="subtle"
      icon={<FluentIcons.Delete16Regular />}
      title={locConstants.schemaDesigner.delete}
      onClick={() => context.deleteSelectedNodes()}
    >
      {locConstants.schemaDesigner.delete}
    </Button>
  );
}
