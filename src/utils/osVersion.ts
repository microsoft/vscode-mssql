/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import * as osNode from 'os';

export let os = {
    platform: osNode.platform(),
    release: osNode.release()
};

// Minimum Windows RS3 version number
const windows10RS3MinVersion = '10.0.16299';

// Minimum Windows RS4 version number
const windows10RS4MinVersion = '10.0.17134';

// Minimum Windows RS5 version number
const windows10RS5MinVersion = '10.0.17763';

export function isWindows(): boolean {
    return os.platform === 'win32';
}

export function isWindows10RS5OrNewer(): boolean {
  if (!isWindows()) {
    return false;
  }

  return semver.gte(os.release, windows10RS5MinVersion);
}

export function isWindows10RS4OrNewer(): boolean {
    if (!isWindows()) {
        return false;
    }

    return semver.gte(os.release, windows10RS4MinVersion);
}

export function isWindows10RS3OrNewer(): boolean {
    if (!isWindows()) {
        return false;
    }

    return semver.gte(os.release, windows10RS3MinVersion);
}

export function isLinux(): boolean {
    return !isMac() && !isWindows();
}

export function isMac(): boolean {
    return os.platform === 'darwin';
}
