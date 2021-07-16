/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { readFile as fsreadFile } from 'fs';
import { promisify } from 'util';
import * as ejs from 'ejs';
import * as path from 'path';
import { ISelectionData, ISlickRange } from '../models/interfaces';
import { generateGuid } from '../models/utils';
import { createProxy, IMessageProtocol, IServerProxy, IWebviewProxy } from '../protocol';
import { ModelViewImpl } from './modelViewImpl';
import { DialogImpl } from './dialogImpl';
import * as azdata from './interfaces';
import * as vscode from 'vscode';
