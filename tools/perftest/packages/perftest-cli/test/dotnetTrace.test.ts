/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";

import { buildDotnetTraceArgs, formatDotnetTraceDuration } from "../src/collectors/dotnetTrace";

describe("dotnetTrace command construction", () => {
    it("leaves CPU sampling implicit for dotnet-trace 9 compatibility", () => {
        expect(buildDotnetTraceArgs(42, "C:\\traces\\sts.nettrace", "cpu")).toEqual([
            "collect",
            "--duration",
            "00:00:00:15",
            "--process-id",
            "42",
            "-o",
            "C:\\traces\\sts.nettrace",
        ]);
    });

    it("selects the sampled-allocation EventPipe profile explicitly", () => {
        expect(buildDotnetTraceArgs(73, "sts.nettrace", "gc-verbose")).toEqual([
            "collect",
            "--profile",
            "gc-verbose",
            "--duration",
            "00:00:00:15",
            "--process-id",
            "73",
            "-o",
            "sts.nettrace",
        ]);
    });

    it("formats bounded trace durations without a shell", () => {
        expect(formatDotnetTraceDuration(90_061)).toBe("01:01:01:01");
        expect(formatDotnetTraceDuration(0)).toBe("00:00:00:01");
    });
});
