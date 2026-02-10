/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { UriOwnershipCoordinator } from "./uriOwnership/uriOwnershipCoordinator";
export {
    UriOwnershipApi,
    UriOwnershipConfig,
    UriOwnershipDeferredConfig,
    CoordinatingExtensionInfo,
    SqlExtensionCommonFeaturesContribution,
} from "./uriOwnership/types";
export {
    PACKAGE_JSON_COMMON_FEATURES_KEY,
    SET_CONTEXT_COMMAND,
} from "./uriOwnership/constants";
export { discoverCoordinatingExtensions } from "./uriOwnership/discovery";
