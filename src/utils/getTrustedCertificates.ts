/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import { isLinux, isMac, isWindows } from './osVersion';

let _systemCertificates: (string | Buffer)[] | undefined;

export function getTrustedCertificates(importSetting: boolean = true): any {
    try {
        return importSetting ? getCertificatesFromSystem() : [];
    } catch (e) {
        return [];
    }
}

function getCertificatesFromSystem(): (string | Buffer)[] {
    if (!_systemCertificates) {
        // {win,mac}-ca automatically read trusted certificate authorities from the system and place them into the global
        //   Node agent. We don't want them in the global agent because that will affect all other extensions
        //   loaded in the same process, which will make them behave inconsistently depending on whether we're loaded.
        let previousCertificateAuthorities = https.globalAgent.options.ca;
        let certificates: string | Buffer | (string | Buffer)[] = [];

        try {
            if (isWindows()) {
                // Use win-ca fallback logic since nAPI isn't currently compatible with Electron
                // (https://github.com/ukoloff/win-ca/issues/12, https://www.npmjs.com/package/win-ca#availability)
                require('win-ca/fallback');
            } else if (isMac()) {
                require('mac-ca');
            } else if (isLinux()) {
            }
        } finally {
            certificates = https.globalAgent.options.ca;
            https.globalAgent.options.ca = previousCertificateAuthorities;
        }

        if (!certificates) {
            certificates = [];
        } else if (!Array.isArray(certificates)) {
            certificates = [certificates];
        }

        _systemCertificates = certificates;
    }

    return _systemCertificates;
}
