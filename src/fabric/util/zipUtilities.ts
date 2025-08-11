/* eslint-disable security/detect-non-literal-fs-filename */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import JSZip = require('jszip');
import * as glob from 'glob';
import * as crypto from 'crypto';
import * as decomp from 'decompress';

/*
 * Options for creating and unzipping a zip file 
 */
export interface IZipOptions {
    respectGitIgnoreFile?: boolean; // use the .gitignore file to filter out files and folders (if found)
    calculateHash?: boolean; // calculate the hash of the entries added to the zip file
    calculateHashOnly?: boolean; // does not create the zip file, just calculates the hash: performance optimization
    progress?: vscode.Progress<{}> | null;
    debug?: boolean; // for tests
    reporter?: IMessageReporter; // show to the user in the output channel window any zip differences
    filterFolder?: (rootFolder: string, folder: string) => boolean; // Folder: return true to include the folder and its contents

    // local.settings.json can be anywhere in folder structure, and we don't want to zip/store it or include it in hash calculations so replace contents with '' before zip and hash calc 
    filterFile?: (rootFolder: string, filename: string) => { include: boolean, replaceWithEmpty?: boolean };
}

export interface IMessageReporter {
    report(message: string): void;
}

export async function unzipZipFile(srczip: string, destfolder: string, zipOptions?: IZipOptions): Promise<{ hash: string, nEntries: number }> {
    let hash = '';
    let nEntries = 0;
    if (!fs.existsSync(srczip)) {
        throw new Error(`Cannot find file ${srczip}`);
    }
    zipOptions?.reporter?.report(`Unzipping ${srczip} to ${destfolder}`);
    let resUnzip = await decomp(srczip, destfolder);
    let hasher: crypto.Hash | undefined;
    if (zipOptions?.calculateHash) {
        hasher = crypto.createHash('sha256');
        processFolder(destfolder);
        function processFolder(folderPath: string) {
            const files = fs.readdirSync(folderPath);
            files.forEach((fileName) => {
                const filePath = path.resolve(folderPath, fileName);
                if (fs.statSync(filePath).isDirectory()) {
                    processFolder(filePath);
                    nEntries++;
                }
                else {
                    const buf = createBufFromFileWithLineEndingsFixed(fs.readFileSync(filePath, 'utf8'));
                    // convert the buf to a string
                    const bufStr = buf.toString();
                    hasher?.update(bufStr);
                    nEntries++;
                }
            });
        }
        hash = hasher.digest('base64');
    }
    else {
        nEntries = resUnzip.length;
    }
    return { hash, nEntries: nEntries };
}

export function createBufFromFileWithLineEndingsFixed(text: string): ArrayBuffer {
    // read the file contents into a string and replace all line endings so works with windows and linux
    const bText = text.replace(/\r?\n|\n?\r|\r/g, '\n');
    const buf = Buffer.from(bText, 'utf8');
    return buf;
}

/**
 * Create a zip file from a directory. If the Dir is named "src" then the zip file will be named "src.zip". 
 * The content of src will be zipped. The top level folder "src" will not be included in the zip file: just it's entire contents recursively
 * @param destZipFile the path to the output file to create, e.g. "<path>\MyZipFile.zip"
 * @param srcdir the path to the directory to zip, e.g. "<path>\src"
 */
async function getTempZipFileName(): Promise<string> {
    const tempdir = os.tmpdir();
    const destZipFile = tempdir + '/MyZipFile.zip';
    if (fs.existsSync(destZipFile)) {
        console.log(`Deleting existing file ${destZipFile}`);
        fs.unlinkSync(destZipFile);
        // await new Promise(async (resolve, reject) => {
        //     await fs.unlink(destZipFile, () => {
        //         Promise.resolve();
        //     });
        // });
    }
    return destZipFile;
}

async function getArrayOfFilesToIncludeFromGitIgnore(srcDir: string, zipOptions?: IZipOptions): Promise<string[]> {
    const fabricIgnoreFileName = '.fabricignore';
    const gitgnoreFileName = '.gitignore';
    let arrayFilesToInclude: string[] = [];
    if (zipOptions?.respectGitIgnoreFile) {
        // we'll use a '.fabricignore' file to specify what to include in the zip. If it doesn't exist, we'll use the '.gitignore' file if it exists
        // that way the user can have different settings for FabricIgnore. The .gitignore semantics is slightly different how we're using it here
        // for example, nested .gitignore's will not be processed. Also, negated patterns are not supported
        const fabricIgnoreFullPathName = path.resolve(srcDir, fabricIgnoreFileName);
        let gitIgnoreFileFullPathName = path.resolve(srcDir, gitgnoreFileName);
        if (fs.existsSync(fabricIgnoreFullPathName)) {
            zipOptions?.reporter?.report(`Using .fabricignore file ${fabricIgnoreFullPathName}`);
            gitIgnoreFileFullPathName = fabricIgnoreFullPathName;
        }
        if (fs.existsSync(gitIgnoreFileFullPathName)) {
            zipOptions?.reporter?.report(`Reading gitignore file ${gitIgnoreFileFullPathName}`);
            let gitIgnoreLines = fs.readFileSync(gitIgnoreFileFullPathName).toString().split('\n').filter((line) => {
                // remove blank, comment and negation ('!**/packages/build/', '!*.[Cc]ache/')
                return line.trim().length > 0 && !line.startsWith('#') && !line.startsWith('!');
            });
            // convert the gitignore pattern to a minimatch pattern, removing cr/lf
            gitIgnoreLines = gitIgnoreLines.map(e => gitignoreToMinimatch(e.trim()));

            arrayFilesToInclude = glob.sync(
                '**/*.*',
                {
                    cwd: srcDir,
                    ignore: gitIgnoreLines,
                    dot: false, // whether to include files that start with '.' like .gitignore, but we want to exclude .vscode
                    posix: true, // whether, in the case of windows, to use / instead of \
                });
            // we want to include any .ignore files
            [fabricIgnoreFileName, gitgnoreFileName].forEach((file) => {
                if (fs.existsSync(path.resolve(srcDir, file))) {
                    arrayFilesToInclude.push(file);
                }
            });
            if (zipOptions?.debug) {
                console.log(`gitIgnoreLines.length = ${gitIgnoreLines.length}  arrayFilesToInclude.length = ${arrayFilesToInclude.length}`);
                arrayFilesToInclude.forEach((file) => {
                    console.log(`File to include ${file}`);
                });
            }
            //TODO: performance:  if we use a Set() and include the intermediate directories, then lookup will be faster
        }
    }
    return arrayFilesToInclude;
}

/**
 * Create a zip file from a directory. If the provided destdir is empty, will create a temp file name
 */
export async function createZipFile(
    destZipFile: string,
    srcDir: string,
    zipOptions?: IZipOptions
): Promise<{ zipFileName: string, hash: string, nEntries: number }> {
    if (destZipFile.length === 0) {
        destZipFile = await getTempZipFileName();
    }
    let debugit = function (str: string) { };
    if (zipOptions?.debug) {
        debugit = function (str: string) {
            zipOptions?.reporter?.report(str);
        };
    }

    const zipCreate = new JSZip();
    let nEntriesAdded = 0;
    let hasher: crypto.Hash | undefined;
    let hash: string = '';
    if (zipOptions?.calculateHash || zipOptions?.calculateHashOnly) {
        hasher = crypto.createHash('sha256');
    }
    try {
        if (!fs.existsSync(srcDir)) {
            throw new Error('srcdir does not exist ' + srcDir);
        }
        if (zipOptions?.calculateHashOnly) {
            console.log(`Calculating Hash Only  ${srcDir}`);
        }
        else {
            console.log(`Starting to zip ${srcDir} into ${destZipFile}`);
            zipOptions?.progress?.report({ increment: 10, message: 'Starting to Zip' });
        }
        let arrayFilesToIncludeFromGitIgnore: string[] = await getArrayOfFilesToIncludeFromGitIgnore(srcDir, zipOptions); // files to include (if found) relative to srcdir,  guided by .gitignore or .fabricignore. 
        addFolderToZip(zipCreate, srcDir);

        function addFolderToZip(zip: JSZip, folderPath: string) {
            const files = fs.readdirSync(folderPath).sort((a, b) => a.localeCompare(b)); // linux mac and windows have different sort orders, wreaking havoc on the hash

            files.forEach((fileName) => {
                const filePath = path.resolve(folderPath, fileName);//`${folderPath}/${fileName}`;
                let includeit = false;
                // if the filePath is in the arrayFilesToInclude, then add it to the zip
                const testPath = filePath.substring(srcDir.length + 1).replace(/\\/g, '/'); // replace all \ with /
                if (arrayFilesToIncludeFromGitIgnore.length === 0) {
                    includeit = true;
                }
                else {
                    // find an entry in the arrayFilesToInclude that starts with the testPath
                    for (let i = 0; i < arrayFilesToIncludeFromGitIgnore.length; i++) { // there's gotta be a faster way!
                        // eslint-disable-next-line security/detect-object-injection
                        if (arrayFilesToIncludeFromGitIgnore[i].startsWith(testPath)) {
                            // eslint-disable-next-line security/detect-object-injection
                            if (arrayFilesToIncludeFromGitIgnore[i] === testPath) {
                                // remove it from the array
                                arrayFilesToIncludeFromGitIgnore.splice(i, 1);
                            }
                            includeit = true;
                            break;
                        }
                    }
                }
                if (includeit) {
                    includeit = false;
                    if (nEntriesAdded > 0 && nEntriesAdded % 1000 === 0) {
                        zipOptions?.progress?.report({ message: `zipping Entries = ${nEntriesAdded}}` });
                    }
                    if (fs.statSync(filePath).isDirectory()) {
                        if (zipOptions?.filterFolder ? zipOptions.filterFolder(srcDir, filePath) : true) {
                            nEntriesAdded++;
                            const zf = zip.folder(fileName);
                            if (zf !== null) {
                                addFolderToZip(zf, filePath);
                            }
                        }
                    }
                    else {
                        let replWithEmpty = false; // if true, then replace the file with an empty file (for example, local.settings.json)
                        const relativePath = filePath.substring(srcDir.length + 1);
                        if (zipOptions?.filterFile) {
                            // remove the srcDir from the filePath
                            const { include, replaceWithEmpty } = zipOptions.filterFile(srcDir, relativePath);
                            if (include) {
                                includeit = true;
                            }
                            replWithEmpty = replaceWithEmpty ? true : false;
                        }
                        else {
                            includeit = true;
                        }
                        if (includeit) {
                            nEntriesAdded++;
                            if (zipOptions?.calculateHash || zipOptions?.calculateHashOnly) {
                                let txt = fs.readFileSync(filePath, 'utf8') + relativePath.replace(/\\/g, '/'); // Add relative path in case user renamed file.  replace all \ with /
                                if (replWithEmpty) {
                                    txt = '';
                                }
                                // const buf = Buffer.from(txt, 'utf8');
                                const buf = createBufFromFileWithLineEndingsFixed(txt);
                                const txtraw = buf.toString();
                                if (zipOptions?.debug) { // for additional debugging: uncomment this block to get individual file hashes and log output
                                    let hasher2 = crypto.createHash('sha256');
                                    hasher2.update(txtraw);
                                    const hash2 = hasher2.digest('base64');
                                    debugit(`Hashing ${filePath} = ${hash2} replWithEmpty = ${replWithEmpty} len = ${txtraw.length}`);
                                }
                                hasher?.update(txtraw);
                            }
                            if (replWithEmpty) {
                                debugit(`Zeroing out file ${filePath}`);
                                zip.file(fileName, ''); // create an empty file
                            }
                            else {
                                const textToZip = fs.readFileSync(filePath);
                                zip.file(fileName, textToZip);
                            }
                        }
                    }
                }
            });
        }
        console.log(`Done collecting zip #Entries = ${nEntriesAdded}`);
        if (!zipOptions?.calculateHashOnly) {
            // https://stuk.github.io/jszip/documentation/howto/write_zip.html
            const nodeStrm = zipCreate.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 9 } });
            const wstrm = fs.createWriteStream(destZipFile);
            const resPipe: fs.WriteStream = nodeStrm.pipe(wstrm);
            const event = 'finish'; // we want to await the finish event
            await new Promise<void>((resolve, reject) => {
                const listener = () => {
                    {
                        resPipe.removeListener(event, listener);
                        resPipe.close();
                        resPipe.destroy();
                        wstrm.close();
                        wstrm.destroy();
                        resolve();
                    }
                };
                resPipe.addListener(event, listener);
            });
            console.log(`Done zip #Entries = ${nEntriesAdded}  ${destZipFile}`);
        }
        if (hasher) {
            hash = hasher.digest('base64');
            debugit(` ${srcDir} Calculated Hash = '${hash}   #Entries = ${nEntriesAdded}`);
        }
    }
    catch (error) {
        debugit(`Error creating zip file ${destZipFile}  ${error}`);
        return Promise.reject(error);
    }
    return { zipFileName: destZipFile, hash: hash, nEntries: nEntriesAdded };
}


/**
https://github.com/humanwhocodes/gitignore-to-minimatch/blob/main/src/gitignore-to-minimatch.js 
* @fileoverview Utility to convert gitignore patterns to minimatch.
 * @author Nicholas C. Zakas
 */

/**
 * Converts a gitignore pattern to a minimatch pattern.
 * @param {string} pattern The gitignore pattern to convert. 
 * @returns {string} A minimatch pattern equivalent to `pattern`.
 */
export function gitignoreToMinimatch(pattern: string) {

    if (typeof pattern !== 'string') {
        throw new TypeError('Argument must be a string.');
    }

    // Special case: Empty string
    if (!pattern) {
        return pattern;
    }

    // strip off negation to make life easier
    const negated = pattern.startsWith('!');
    let patternToTest = negated ? pattern.slice(1) : pattern;
    let result = patternToTest;
    let leadingSlash = false;

    // strip off leading slash
    if (patternToTest[0] === '/') {
        leadingSlash = true;
        result = patternToTest.slice(1);
    }

    // For the most part, the first character determines what to do
    switch (result[0]) {

        case '*':
            if (patternToTest[1] !== '*') {
                result = '**/' + result;
            }
            break;

        default:
            if (!leadingSlash && !result.includes('/') || result.endsWith('/')) {
                result = '**/' + result;
            }

            // no further changes if the pattern ends with a wildcard
            if (result.endsWith('*') || result.endsWith('?')) {
                break;
            }

            // differentiate between filenames and directory names
            if (!/\.[a-z\d_-]+$/.test(result)) {
                if (!result.endsWith('/')) {
                    result += '/';
                }

                result += '**';
            }
    }

    return negated ? '!' + result : result;
}

export async function createTestZipFile(relativePath: string, descid: string): Promise<{ destZipFile: string, nEntriesAdded: number }> {
    let destdir: fs.PathLike = path.resolve(os.tmpdir(), `tempdir${descid}`);  // make dirs unique so tests can run in parallel
    if (!fs.existsSync(destdir)) {
        fs.mkdir(destdir, (p) => {
            console.log(p);
        });
    }
    else {
        await fse.emptyDir(destdir);
    }
    let srcdir: fs.PathLike = path.resolve(__dirname, relativePath);
    const destZipFile = destdir + '/MyZipFile.zip';
    const resZip = await createZipFile(destZipFile, srcdir);
    return { destZipFile, nEntriesAdded: resZip.nEntries };
}