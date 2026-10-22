/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";

/** Reject traversal and links (including Windows junctions) at every existing component. */
export function containedPath(root: string, candidate: string): string {
    const base = path.resolve(root);
    const resolved = path.resolve(candidate);
    const relative = path.relative(base, resolved);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        throw new Error("path escapes the source root");
    }
    let current = base;
    for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
        current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw new Error("symbolic links are not allowed in diagnostic sources");
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
            throw error;
        }
    }
    return resolved;
}

export function isContainedPath(root: string, candidate: string): boolean {
    try {
        containedPath(root, candidate);
        return true;
    } catch {
        return false;
    }
}
