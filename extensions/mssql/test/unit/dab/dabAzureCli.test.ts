/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import {
    DAB_AZURE_CLI_PIP_PACKAGE_COUNT,
    PipInstallProgress,
    writeAzureCliLauncher,
} from "../../../src/dab/dabAzureCli";

suite("DAB Azure CLI", () => {
    let root: string;

    setup(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "dab-azure-cli-"));
    });

    teardown(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    test("launcher runs the Azure CLI from a path with a space and a quote", async function () {
        if (process.platform === "win32") {
            this.skip();
        }

        // Stands in for the virtual environment's Python and echoes how it was called.
        const venv = path.join(root, "Application Support", "it's here");
        const pythonPath = path.join(venv, "bin", "python");
        await fs.mkdir(path.dirname(pythonPath), { recursive: true });
        await fs.writeFile(pythonPath, '#!/bin/sh\necho "$AZ_INSTALLER" "$@"\n', {
            mode: 0o755,
        });

        const launcherPath = path.join(venv, "launcher", "az");
        await writeAzureCliLauncher(launcherPath, pythonPath);

        const { stdout } = await promisify(execFile)(launcherPath, ["account", "show"], {
            env: { PATH: process.env.PATH },
        });
        expect(stdout.trim()).to.equal("PIP -m azure.cli account show");
    });

    test("pip install progress counts each pass over the packages", () => {
        const progress = new PipInstallProgress();
        const packageCount = DAB_AZURE_CLI_PIP_PACKAGE_COUNT;
        expect(progress.percent).to.equal(0);

        for (let i = 0; i < packageCount; i++) {
            progress.onLine(`Collecting package-${i}>=1.0 (from azure-cli==2.92.0)`);
            progress.onLine(`  Downloading package_${i}-1.0-py3-none-any.whl.metadata (11 kB)`);
        }
        expect(progress.percent).to.equal(33);

        for (let i = 0; i < packageCount / 2; i++) {
            progress.onLine(`Downloading package_${i}-1.0-py3-none-any.whl (14.7 MB)`);
            progress.onLine("Progress 262144 of 14722232");
        }
        expect(progress.percent).to.equal(50);
        expect(progress.isInstalling).to.be.false;

        const names = Array.from({ length: packageCount - 1 }, (_, i) => `package-${i}`);
        progress.onLine(`Installing collected packages: ${names.join(", ")}`);
        expect(progress.isInstalling).to.be.true;
        expect(progress.percent).to.equal(66);

        progress.setInstalled(names.length / 2);
        expect(progress.percent).to.equal(83);
        progress.setInstalled(names.length);
        expect(progress.percent).to.equal(100);
    });

    test("pip install progress treats the first download as the end of finding packages", () => {
        const progress = new PipInstallProgress();
        progress.onLine("Collecting azure-cli==2.92.0");
        progress.onLine("Using cached azure_cli-2.92.0-py3-none-any.whl (14.7 MB)");

        expect(progress.percent).to.equal(66);
    });
});
