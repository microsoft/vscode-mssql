/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { ArrowUp16Regular } from "@fluentui/react-icons";
import { AzureSqlDatabaseIcon } from "./azureSqlDatabase";

export const AzureSqlDatabaseUploadIcon = Object.assign(
    React.forwardRef<SVGSVGElement, React.SVGAttributes<SVGElement>>((props, ref) => (
        <svg
            ref={ref}
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            {...props}>
            <AzureSqlDatabaseIcon width="22" height="22" aria-hidden="true" />
            <ArrowUp16Regular
                x="12"
                y="12"
                width="12"
                height="12"
                style={{ color: "var(--vscode-foreground)" }}
                aria-hidden="true"
            />
        </svg>
    )),
    { displayName: "AzureSqlDatabaseUploadIcon" },
);
