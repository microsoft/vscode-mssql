var gulp = require('gulp');
var fs = require('fs');
var cproc = require('child_process');
var del = require('del');

function installSqlToolsService(platform) {
	var install = require('../out/src/extension/languageservice/serviceInstallerUtil');
	return install.installService(platform);
}

gulp.task('ext:install-service', () => {
	return installSqlToolsService();
});

function doPackageSync(packageName) {
	var vsceArgs = [];
	vsceArgs.push('vsce');
	vsceArgs.push('package'); // package command

	if (packageName !== undefined) {
		vsceArgs.push('-o');
		vsceArgs.push(packageName);
	}
	var command = vsceArgs.join(' ');
	console.log(command);
	return cproc.execSync(command);
}

function cleanServiceInstallFolder() {
	var install = require('../out/src/extension/languageservice/serviceInstallerUtil');
	var serviceInstallFolder = install.getServiceInstallDirectoryRoot();
	console.log('Deleting Service Install folder: ' + serviceInstallFolder);
	return del(serviceInstallFolder + '/*');
}

function doOfflinePackage(runtimeId, platform, packageName) {
	return installSqlToolsService(platform).then(() => {
		return doPackageSync(packageName + '-' + runtimeId + '.vsix');
	});
}

//Install vsce to be able to run this task: npm install -g vsce
gulp.task('package:online', () => {
	return cleanServiceInstallFolder().then(() => {
		doPackageSync();
		return installSqlToolsService();
	});
});

//Install vsce to be able to run this task: npm install -g vsce
gulp.task('package:offline', () => {
	const platform = require('../out/src/extension/models/platform');
	const Runtime = platform.Runtime;
	var json = JSON.parse(fs.readFileSync('package.json'));
	var name = json.name;
	var version = json.version;
	var packageName = name + '-' + version;

	var packages = [];
	packages.push({ rid: 'win-x64', runtime: Runtime.Windows_64 });
	packages.push({ rid: 'win-x86', runtime: Runtime.Windows_86 });
	packages.push({ rid: 'win-arm64', runtime: Runtime.Windows_ARM64 });
	packages.push({ rid: 'osx.10.11-x64', runtime: Runtime.OSX_10_11_64 });
	packages.push({ rid: 'osx-arm64', runtime: Runtime.OSX_ARM64 });
	packages.push({ rid: 'centos.7-x64', runtime: Runtime.CentOS_7 });
	packages.push({ rid: 'debian.8-x64', runtime: Runtime.Debian_8 });
	packages.push({ rid: 'fedora.23-x64', runtime: Runtime.Fedora_23 });
	packages.push({ rid: 'opensuse.13.2-x64', runtime: Runtime.OpenSUSE_13_2 });
	packages.push({ rid: 'rhel.7.2-x64', runtime: Runtime.RHEL_7 });
	packages.push({ rid: 'ubuntu.14.04-x64', runtime: Runtime.Ubuntu_14 });
	packages.push({ rid: 'ubuntu.16.04-x64', runtime: Runtime.Ubuntu_16 });
	packages.push({ rid: 'linux-arm64', runtime: Runtime.Linux_ARM64 });
	var promise = Promise.resolve();
	cleanServiceInstallFolder().then(() => {
		packages.forEach(data => {
			promise = promise.then(() => {
				return doOfflinePackage(data.rid, data.runtime, packageName).then(() => {
					return cleanServiceInstallFolder();
				});
			});
		});
	});

	return promise;
});