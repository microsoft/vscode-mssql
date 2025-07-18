var path = require('path');

var projectRoot = path.resolve(path.dirname(__dirname));
var srcRoot = path.resolve(projectRoot, 'src');
var outRoot = path.resolve(projectRoot, 'out');
var localization = path.resolve(projectRoot, 'localization');

var config = {
	paths: {
		project: {
			root: projectRoot,
			localization: localization,
			out: outRoot
		},
		extension: {
			root: srcRoot
		},
	}
};

module.exports = config;