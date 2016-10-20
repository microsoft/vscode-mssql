var path = require('path');

var projectRoot = path.resolve(path.dirname(__dirname));
var srcRoot = path.resolve(projectRoot, 'src');
var viewsRoot = path.resolve(srcRoot, 'views');
var htmlcontentRoot = path.resolve(viewsRoot, 'htmlcontent');

var config = {
    paths: {
        project: {
            root: projectRoot
        },
        extension: {
            root: srcRoot
        },
        html: {
            root: htmlcontentRoot
        }
    },
    includes: {
        html: {
            node_modules : [
                htmlcontentRoot + '/node_modules/core-js/client/shim.min.js',
                htmlcontentRoot + '/node_modules/zone.js/dist/zone.js',
                htmlcontentRoot + '/node_modules/reflect-metadata/Reflect.js',
                htmlcontentRoot + '/node_modules/systemjs/dist/system.src.js',
                htmlcontentRoot + '/node_modules/moment/moment.js',
                htmlcontentRoot + '/node_modules/@angular/**/*',
                htmlcontentRoot + '/node_modules/rxjs/**/*',
                htmlcontentRoot + '/node_modules/angular2-in-memory-web-api/**/*',
                htmlcontentRoot + '/node_modules/bootstrap/dist/css/bootstrap.min.css',
                htmlcontentRoot + '/node_modules/bootstrap/dist/fonts/**/*',
                htmlcontentRoot + '/node_modules/systemjs-plugin-json/json.js'
            ]
        }
    }
}

module.exports = config;