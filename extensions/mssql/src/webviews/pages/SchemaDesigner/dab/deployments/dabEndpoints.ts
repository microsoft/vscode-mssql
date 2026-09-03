/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";

export type DabEndpointAction = "copy" | "addToVSCode" | "openUrl";

export interface DabEndpointOpenUrlConfig {
    url: string;
    label: string;
}

export interface DabEndpoint {
    type: Dab.ApiType;
    label: string;
    url: string;
    actions: DabEndpointAction[];
    openUrlConfig?: DabEndpointOpenUrlConfig;
}

/**
 * Builds the endpoints a running DAB container exposes for the given API types.
 *
 * Shared by the deployment completion screen and the deployments list so a
 * deployment's endpoints read the same wherever they are shown.
 *
 * @param apiUrl Base URL the container is published on
 * @param apiTypes API types the container was deployed with
 */
export function getDabEndpoints(
    apiUrl: string | undefined,
    apiTypes: Dab.ApiType[] | undefined,
): DabEndpoint[] {
    if (!apiUrl || !apiTypes?.length) {
        return [];
    }

    const endpoints: DabEndpoint[] = [];

    if (apiTypes.includes(Dab.ApiType.Rest)) {
        endpoints.push({
            type: Dab.ApiType.Rest,
            label: locConstants.schemaDesigner.restApi,
            url: `${apiUrl}/api`,
            actions: ["openUrl", "copy"],
            openUrlConfig: {
                url: `${apiUrl}/swagger/index.html`,
                label: locConstants.schemaDesigner.viewSwagger,
            },
        });
    }

    if (apiTypes.includes(Dab.ApiType.GraphQL)) {
        endpoints.push({
            type: Dab.ApiType.GraphQL,
            label: locConstants.schemaDesigner.graphql,
            url: `${apiUrl}/graphql`,
            actions: ["openUrl", "copy"],
            openUrlConfig: {
                url: `${apiUrl}/graphql`,
                label: locConstants.schemaDesigner.openNitro,
            },
        });
    }

    if (apiTypes.includes(Dab.ApiType.Mcp)) {
        endpoints.push({
            type: Dab.ApiType.Mcp,
            label: locConstants.schemaDesigner.mcp,
            url: `${apiUrl}/mcp`,
            actions: ["addToVSCode"],
        });
    }

    return endpoints;
}
