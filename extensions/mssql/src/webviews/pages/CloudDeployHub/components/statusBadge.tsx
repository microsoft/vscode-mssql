/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge } from "@fluentui/react-components";
import * as React from "react";
import { RunStatus } from "../../../../cloudDeploy/runs/types";
import { locConstants } from "../../../common/locConstants";

const STATUS_COLOR: Record<RunStatus, "success" | "informative" | "warning" | "danger" | "subtle"> =
    {
        [RunStatus.Passed]: "success",
        [RunStatus.Skipped]: "informative",
        [RunStatus.Cancelled]: "subtle",
        [RunStatus.Warning]: "warning",
        [RunStatus.Failed]: "danger",
        [RunStatus.Errored]: "danger",
    };

function statusLabel(status: RunStatus): string {
    const strings = locConstants.cloudDeployHub;
    switch (status) {
        case RunStatus.Passed:
            return strings.statusPassed;
        case RunStatus.Skipped:
            return strings.statusSkipped;
        case RunStatus.Cancelled:
            return strings.statusCancelled;
        case RunStatus.Warning:
            return strings.statusWarning;
        case RunStatus.Failed:
            return strings.statusFailed;
        case RunStatus.Errored:
            return strings.statusErrored;
    }
}

export const StatusBadge: React.FC<{ status: RunStatus }> = ({ status }) => (
    <Badge appearance="filled" color={STATUS_COLOR[status]}>
        {statusLabel(status)}
    </Badge>
);
