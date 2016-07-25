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
    }
}

module.exports = config;