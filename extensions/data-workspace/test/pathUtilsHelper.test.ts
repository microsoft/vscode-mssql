/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "mocha";
import { expect } from "chai";
import * as constants from "../src/common/constants";
import * as os from "os";
import { isValidBasename, isValidBasenameErrorMessage } from "../src/common/pathUtilsHelper";

const isWindows = os.platform() === "win32";

// Windows reserved/forbidden filenames
const windowsForbiddenFilenames: string[] = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
];

// Invalid characters only for Windows
const windowsInvalidCharacters: string[] = ["?", ":", "*", "<", ">", "|", '"', "/", "\\"];

// Windows filenames cannot start or end with whitespace
const windowsInvalidWhitespaceNames: string[] = ["test   ", "test     ", " test"];

suite("Check for invalid filename tests", function (): void {
  test("Should determine invalid filenames", async () => {
    // valid filename
    expect(isValidBasename("ValidName"), "ValidName should be valid").to.equal(true);

    // invalid for both Windows and non-Windows
    let invalidNames: string[] = [
      " ",
      "         ",
      ".",
      "..",
      // most file systems do not allow files > 255 length
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ];

    for (let invalidName of invalidNames) {
      expect(isValidBasename(invalidName), `InvalidName that failed:${invalidName}`).to.equal(
        false,
      );
    }

    expect(isValidBasename(undefined), "undefined should be invalid").to.equal(false);
    expect(isValidBasename("\\"), "backslash should be invalid").to.equal(false);
    expect(isValidBasename("/"), "forward slash should be invalid").to.equal(false);
  });

  test("Should determine invalid Windows filenames", async () => {
    const invalidNames = [...windowsInvalidCharacters, ...windowsInvalidWhitespaceNames];

    for (let invalidName of invalidNames) {
      expect(
        isValidBasename(invalidName),
        `'${invalidName}' should be ${isWindows ? "invalid" : "valid"} on ${isWindows ? "Windows" : "non-Windows"}`,
      ).to.equal(isWindows ? false : true);
    }
  });

  test("Should determine Windows forbidden filenames", async () => {
    for (let invalidName of windowsForbiddenFilenames) {
      expect(
        isValidBasename(invalidName),
        `'${invalidName}' should be ${isWindows ? "invalid" : "valid"} on ${isWindows ? "Windows" : "non-Windows"}`,
      ).to.equal(isWindows ? false : true);
    }
  });
});

suite("Check for invalid filename error tests", function (): void {
  test("Should determine invalid filenames", async () => {
    // valid filename
    expect(isValidBasenameErrorMessage("ValidName"), "ValidName should return no error").to.equal(
      undefined,
    );

    // invalid for both Windows and non-Windows
    expect(
      isValidBasenameErrorMessage("        "),
      "whitespace-only filename should return whitespace error",
    ).to.equal(constants.whitespaceFilenameErrorMessage);
    expect(
      isValidBasenameErrorMessage(" "),
      "single space filename should return whitespace error",
    ).to.equal(constants.whitespaceFilenameErrorMessage);
    expect(
      isValidBasenameErrorMessage("."),
      "single period filename should return period error",
    ).to.equal(constants.filenameEndingIsPeriodErrorMessage);
    expect(
      isValidBasenameErrorMessage(".."),
      "double period filename should return period error",
    ).to.equal(constants.filenameEndingIsPeriodErrorMessage);
    expect(
      isValidBasenameErrorMessage(undefined),
      "undefined filename should return undefined error",
    ).to.equal(constants.undefinedFilenameErrorMessage);
    expect(
      isValidBasenameErrorMessage("\\"),
      "backslash filename should return invalid chars error",
    ).to.equal(constants.invalidFileCharsErrorMessage);
    expect(
      isValidBasenameErrorMessage("/"),
      "forward slash filename should return invalid chars error",
    ).to.equal(constants.invalidFileCharsErrorMessage);

    // most file systems do not allow files > 255 length
    expect(
      isValidBasenameErrorMessage(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
      "filename > 255 chars should return too long error",
    ).to.equal(constants.tooLongFilenameErrorMessage);
  });

  test("Should determine invalid Windows filenames", async () => {
    for (let invalidName of windowsInvalidCharacters) {
      expect(
        isValidBasenameErrorMessage(invalidName),
        `'${invalidName}' should return ${isWindows ? "invalid chars error" : "empty string"} on ${isWindows ? "Windows" : "non-Windows"}`,
      ).to.equal(isWindows ? constants.invalidFileCharsErrorMessage : "");
    }
    // Windows filenames cannot start or end with a whitespace
    for (let invalidName of windowsInvalidWhitespaceNames) {
      expect(
        isValidBasenameErrorMessage(invalidName),
        `'${invalidName}' should return ${isWindows ? "trailing whitespace error" : "empty string"} on ${isWindows ? "Windows" : "non-Windows"}`,
      ).to.equal(isWindows ? constants.trailingWhitespaceErrorMessage : "");
    }
  });

  test("Should determine Windows forbidden filenames", async () => {
    for (let invalidName of windowsForbiddenFilenames) {
      expect(
        isValidBasenameErrorMessage(invalidName),
        `InvalidName that failed:${invalidName}`,
      ).to.equal(isWindows ? constants.reservedWindowsFilenameErrorMessage : "");
    }
  });
});
