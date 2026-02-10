/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Dockerode from "dockerode";
import fixPath from "fix-path";

let dockerodeClient: Dockerode | undefined;

export function getDockerodeClient(): Dockerode {
    // Keep PATH aligned with user shell for Docker socket/env discovery when launched from VS Code.
    fixPath();

    if (!dockerodeClient) {
        dockerodeClient = new Dockerode();
    }

    return dockerodeClient;
}
