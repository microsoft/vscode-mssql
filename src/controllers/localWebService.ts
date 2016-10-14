'use strict';
import path = require('path');
import Utils = require('../models/utils');
import Constants = require('../models/constants');
import Interfaces = require('../models/interfaces');
const bodyParser = require('body-parser');
const express = require('express');

export default class LocalWebService {
    private app = express();
    static _servicePort: string;
    static _vscodeExtensionPath: string;
    static _htmlContentLocation = 'out/src/views/htmlcontent/src';
    static _staticContentPath: string;

    constructor(extensionPath: string) {
        // add static content for express web server to serve
        LocalWebService._vscodeExtensionPath = extensionPath;
        LocalWebService._staticContentPath = path.join(extensionPath, LocalWebService._htmlContentLocation);
        this.app.use(express.static(LocalWebService.staticContentPath));
        this.app.use( bodyParser.json() );
        this.app.set('view engine', 'ejs');
        Utils.logDebug(Constants.msgLocalWebserviceStaticContent + LocalWebService.staticContentPath);
    }

    static get serviceUrl(): string {
        return Constants.outputServiceLocalhost + LocalWebService._servicePort;
    }

    static get staticContentPath(): string {
        return LocalWebService._staticContentPath;
    }

    static get extensionPath(): string {
        return LocalWebService._vscodeExtensionPath;
    }

    static getEndpointUri(type: Interfaces.ContentType): string {
        return this.serviceUrl + '/' + Interfaces.ContentTypes[type];
    }

    addHandler(type: Interfaces.ContentType, handler: (req, res) => void): void {
        let segment = '/' + Interfaces.ContentTypes[type];
        this.app.get(segment, handler);
    }

    addPostHandler(type: Interfaces.ContentType, handler: (req, res) => void): void {
        let segment = '/' + Interfaces.ContentTypes[type];
        this.app.post(segment, handler);
    }

    start(): void {
        const port = this.app.listen(0).address().port; // 0 = listen on a random port
        Utils.logDebug(Constants.msgLocalWebserviceStarted + port);
        LocalWebService._servicePort = port.toString();
    }
}
