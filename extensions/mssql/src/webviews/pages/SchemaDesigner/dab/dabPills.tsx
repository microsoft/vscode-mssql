/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode } from "react";
import { mergeClasses } from "@fluentui/react-components";
import { Dab } from "../../../../sharedInterfaces/dab";
import "./dabPills.css";

export function getDabApiTypePillClassName(apiType: Dab.ApiType): string {
    switch (apiType) {
        case Dab.ApiType.Rest:
            return "dab-pill dab-pill-rest";
        case Dab.ApiType.GraphQL:
            return "dab-pill dab-pill-graphql";
        case Dab.ApiType.Mcp:
            return "dab-pill dab-pill-mcp";
    }
}

export function getDabPermissionPillClassName(role: Dab.AuthorizationRole): string {
    return role === Dab.AuthorizationRole.Anonymous
        ? "dab-pill dab-pill-anonymous"
        : "dab-pill dab-pill-authenticated";
}

export function DabCountPill({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={mergeClasses("dab-count-pill", className)}>{children}</span>;
}
