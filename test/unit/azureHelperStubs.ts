/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import Sinon from "sinon";

export function stubPromptForAzureSubscriptionFilter(sandbox: Sinon.SinonSandbox, result: boolean) {
    return sandbox.stub(AzureHelpers, "promptForAzureSubscriptionFilter").resolves(result);
}
