/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DabConfigFileBuilder } from "../dab/dabConfigFileBuilder";
import { Dab } from "../sharedInterfaces/dab";

export class DabService implements Dab.IDabService {
    private _configFileBuilder = new DabConfigFileBuilder();

    public generateConfig(
        config: Dab.DabConfig,
        connectionInfo: Dab.DabConnectionInfo,
    ): Dab.GenerateConfigResponse {
        try {
            const configContent = this._configFileBuilder.build(config, connectionInfo);
            return {
                configContent,
                success: true,
            };
        } catch (error) {
            return {
                configContent: "",
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
