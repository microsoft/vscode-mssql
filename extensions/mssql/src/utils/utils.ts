/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from "fs";
import * as vscode from "vscode";
import type { PagedAsyncIterableIterator } from "@azure/core-paging";
import { IConnectionInfo } from "vscode-mssql";
import * as os from "os";
import { FormItemSpec, FormState } from "../sharedInterfaces/form";
import xmlFormatter from "xml-formatter";

export async function exists(path: string, uri?: vscode.Uri): Promise<boolean> {
  if (uri) {
    const fullPath = vscode.Uri.joinPath(uri, path);
    try {
      await vscode.workspace.fs.stat(fullPath);
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      await fs.access(path);
      return true;
    } catch (e) {
      return false;
    }
  }
}

/**
 * Generates a unique URI for a file in the specified folder using the
 * provided basename and file extension
 */
export async function getUniqueFilePath(
  folder: vscode.Uri,
  basename: string,
  fileExtension: string,
): Promise<vscode.Uri> {
  let uniqueFileName: vscode.Uri;
  let counter = 1;
  if (await exists(`${basename}.${fileExtension}`, folder)) {
    while (await exists(`${basename}${counter}.${fileExtension}`, folder)) {
      counter += 1;
    }
    uniqueFileName = vscode.Uri.joinPath(
      folder,
      `${basename}${counter}.${fileExtension}`,
    );
  } else {
    uniqueFileName = vscode.Uri.joinPath(
      folder,
      `${basename}.${fileExtension}`,
    );
  }
  return uniqueFileName;
}

/**
 * Generates a random nonce value that can be used in a webview
 */
export function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class CancelError extends Error {}

export function isIConnectionInfo(
  connectionInfo: any,
): connectionInfo is IConnectionInfo {
  return (
    (connectionInfo &&
      connectionInfo.server &&
      connectionInfo.authenticationType) ||
    connectionInfo.connectionString
  );
}

/**
 * Consolidates on the error message string
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getErrorMessage(error: any): string {
  return error instanceof Error
    ? typeof error.message === "string"
      ? error.message
      : ""
    : typeof error === "string"
      ? error
      : `${JSON.stringify(error, undefined, "\t")}`;
}

// Copied from https://github.com/microsoft/vscode-azuretools/blob/5794d9d2ccbbafdb09d44b2e1883e515077e4a72/azure/src/utils/uiUtils.ts#L26
export async function listAllIterator<T>(
  iterator: PagedAsyncIterableIterator<T>,
): Promise<T[]> {
  const resources: T[] = [];
  for await (const r of iterator) {
    resources.push(r);
  }

  return resources;
}

/**
 * Gets a unique key for the given URI to be used in maps or sets to identify the URI uniquely.
 * @param uri The URI to get the unique key for.
 * @returns A unique string key for the URI.
 */
export function getUriKey(uri: vscode.Uri): string {
  return uri?.toString(true);
}

/**
 * Gets the end-of-line character sequence configured in the editor.
 * @returns The end-of-line character sequence.
 */
export function getEditorEOL(): string {
  return vscode.workspace.getConfiguration("files").get<string>("eol") ===
    "auto"
    ? os.EOL
    : vscode.workspace.getConfiguration("files").get<string>("eol");
}

/**
 * Parses a value into the corresponding enum type.  Example:
 * enum ContentType {
 *   Message = "messageContent",
 *   Flag = "flagContent"
 * }
 * @param enumObj the enum type of the value being parsed (e.g. ContentType)
 * @param value the enum value to be parsed (e.g. "Message" or "messageContent")
 * @returns the enum (e.g. ContentType.Message), or undefined if not found
 */
export function parseEnum<T extends Record<string, string | number>>(
  enumObj: T,
  value: string | number,
): T[keyof T] | undefined {
  // Try key lookup
  if (value in enumObj) {
    return enumObj[value as keyof T];
  }

  // Try value lookup
  const entry = Object.entries(enumObj).find(([_, v]) => v === value);
  if (entry) {
    return entry[1] as T[keyof T];
  }

  return undefined;
}

/**
 * Removes all properties with undefined values from the given object.  Null values are kept.
 * @returns a Partial of the original object type with only defined (including null) properties.
 */
export function removeUndefinedProperties<T extends object>(
  source: T,
): Partial<T> {
  if (!source) {
    return {};
  }

  const entries = Object.entries(source).filter(
    ([_key, value]) => value !== undefined,
  );
  return Object.fromEntries(entries) as Partial<T>;
}

/**
 * Checks if any required fields are missing values in a form.
 * Used to determine if form submission buttons should be disabled.
 *
 * @param formComponents - The form components to check
 * @param formState - The current form state with values
 * @returns true if any required fields are missing values, false otherwise
 */
export function hasAnyMissingRequiredValues<
  TForm,
  TState extends FormState<TForm, TState, TFormItemSpec>,
  TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
>(
  formComponents: Partial<Record<keyof TForm, TFormItemSpec>>,
  formState: TForm,
): boolean {
  return Object.values(formComponents).some(
    (component: TFormItemSpec | undefined) => {
      if (!component || component.hidden || !component.required) return false;

      const value = formState[component.propertyName as keyof TForm];
      return (
        value === undefined ||
        (typeof value === "string" && value.trim() === "") ||
        (typeof value === "boolean" && value !== true)
      );
    },
  );
}

export function formatXml(xml: string): string {
  const multipleNodesErrorMessage = "Found multiple root nodes";
  try {
    return xmlFormatter(xml);
  } catch (e) {
    // some XML fragments may not have a single root node, which xml-formatter requires
    // in that case, we can wrap it in a root node, format it, then remove the root node
    if (e.message === multipleNodesErrorMessage) {
      const wrapped = `<root>${xml}</root>`;
      try {
        return xmlFormatter(wrapped)
          .replace(/^<root>\s*\n?/, "") // remove opening root tag
          .replace(/\n?\s*<\/root>$/, "") // remove closing root tag
          .replace(/^\s+/gm, ""); // remove leading spaces from each child line
      } catch {
        return xml; // return unformatted XML on error
      }
    } else {
      return xml; // return unformatted XML on error
    }
  }
}
