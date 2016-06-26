'use strict';
import vscode = require('vscode');
import path = require('path');
import fs = require('fs');
import Utils = require('../models/utils');
import Constants = require('../models/constants');
import Interfaces = require('../models/interfaces');
var express = require('express');

export default class LocalWebService
{
    private app = express();
    static _servicePort: string;
    static _vscodeExtensionPath: string;
    static _htmlContentLocation = "src/views/htmlcontent";
    static _staticContentPath: string;

    constructor(extensionPath: string)
    {
        // add static content for express web server to serve
        LocalWebService._vscodeExtensionPath = extensionPath;
        LocalWebService._staticContentPath = path.join(extensionPath, LocalWebService._htmlContentLocation);
        this.app.use(express.static(LocalWebService.staticContentPath));
        Utils.logDebug(Constants.gMsgLocalWebserviceStaticContent + LocalWebService.staticContentPath);
    }

    static get serviceUrl(): string {
        return Constants.gOutputServiceLocalhost + LocalWebService._servicePort;
    }

    static get staticContentPath(): string {
        return LocalWebService._staticContentPath;
    }

    static get extensionPath(): string {
        return LocalWebService._vscodeExtensionPath;
    }

    static getEndpointUri(type: Interfaces.ContentType): string
    {
        return this.serviceUrl + "/" + Interfaces.ContentTypes[type];
    }

    addHandler(type: Interfaces.ContentType, handler: (req, res) => void) {
        let segment = "/" + Interfaces.ContentTypes[type];
        this.app.get(segment, handler);
    }

    start()
    {
        const port = this.app.listen(0).address().port; // 0 = listen on a random port
        Utils.logDebug(Constants.gMsgLocalWebserviceStarted + port);
        LocalWebService._servicePort = port.toString();
    }
}