/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDecompressProvider, IPackage } from './interfaces';
import { ILogger } from '../models/interfaces';
import * as DecompressTar from 'tar';
import AdmZip from 'adm-zip';
export default class DecompressProvider implements IDecompressProvider {

	private decompressZip(pkg: IPackage, logger: ILogger): Promise<void> {
		const zip = new AdmZip(pkg.tmpFile.name);
		logger.appendLine(`Unpacking ${pkg.tmpFile.name} to ${pkg.installPath}...`);
		return new Promise<void>((resolve, reject) => {
			zip.extractAllTo(pkg.installPath, true, false);
			logger.appendLine('Done!\n');
			resolve();
		});
	}

	private decompressTar(pkg: IPackage, logger: ILogger): Promise<void> {
		let totalFiles = 0;
		return DecompressTar.extract({
			file: pkg.tmpFile.name,
			cwd: pkg.installPath,
			onentry: () => { totalFiles++; },
			onwarn: (warn) => {
				if (warn.data && !warn.data.recoverable) {
					logger.appendLine(`[ERROR] ${warn.message}`);
				}
			}
		}, () => { logger.appendLine(`Done! ${totalFiles} files unpacked.\n`); });
	}

	public decompress(pkg: IPackage, logger: ILogger): Promise<void> {
		if (pkg.isZipFile) {
			return this.decompressZip(pkg, logger);
		} else {
			return this.decompressTar(pkg, logger);
		}
	}
}
