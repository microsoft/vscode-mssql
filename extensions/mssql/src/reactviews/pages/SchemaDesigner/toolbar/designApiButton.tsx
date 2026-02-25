/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { PlugConnected20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";

interface DesignApiButtonProps {
    onNavigateToDab?: () => void;
}

export function DesignApiButton({ onNavigateToDab }: DesignApiButtonProps) {
    return (
        <Tooltip content={locConstants.schemaDesigner.designApi} relationship="label">
            <Button
                appearance="primary"
                size="small"
                icon={<PlugConnected20Regular />}
                onClick={onNavigateToDab}>
                {locConstants.schemaDesigner.designApi}
            </Button>
        </Tooltip>
    );
}
