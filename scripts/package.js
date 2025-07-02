
const fs = require("fs");
const path = require("path");
const cproc = require("child_process");
const del = require("del");
const { argv } = require("yargs")
  .option("mode", {
    describe: "Package mode: online or offline",
    choices: ["online", "offline"],
    demandOption: true,
  });

async function installSqlToolsService(platform) {
  const install = require("../out/src/extension/languageservice/serviceInstallerUtil");
  return install.installService(platform);
}

function doPackageSync(packageName) {
  const vsceArgs = ["vsce", "package"];
  if (packageName) {
    vsceArgs.push("-o", packageName);
  }
  const command = vsceArgs.join(" ");
  console.log(`Running: ${command}`);
  return cproc.execSync(command, { stdio: "inherit" });
}

function cleanServiceInstallFolder() {
  const install = require("../out/src/extension/languageservice/serviceInstallerUtil");
  const serviceInstallFolder = install.getServiceInstallDirectoryRoot();
  console.log(`Deleting Service Install folder: ${serviceInstallFolder}`);
  return del(`${serviceInstallFolder}/*`);
}

async function doOfflinePackage(runtimeId, platform, packageName) {
  await installSqlToolsService(platform);
  doPackageSync(`${packageName}-${runtimeId}.vsix`);
}

async function runOnlinePackage() {
  await cleanServiceInstallFolder();
  doPackageSync();
  await installSqlToolsService();
}

async function runOfflinePackage() {
  const platform = require("../out/src/extension/models/platform");
  const Runtime = platform.Runtime;
  const json = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const packageName = `${json.name}-${json.version}`;

  const targets = [
    { rid: "win-x64", runtime: Runtime.Windows_64 },
    { rid: "win-x86", runtime: Runtime.Windows_86 },
    { rid: "win-arm64", runtime: Runtime.Windows_ARM64 },
    { rid: "osx.10.11-x64", runtime: Runtime.OSX_10_11_64 },
    { rid: "osx-arm64", runtime: Runtime.OSX_ARM64 },
    { rid: "centos.7-x64", runtime: Runtime.CentOS_7 },
    { rid: "debian.8-x64", runtime: Runtime.Debian_8 },
    { rid: "fedora.23-x64", runtime: Runtime.Fedora_23 },
    { rid: "opensuse.13.2-x64", runtime: Runtime.OpenSUSE_13_2 },
    { rid: "rhel.7.2-x64", runtime: Runtime.RHEL_7 },
    { rid: "ubuntu.14.04-x64", runtime: Runtime.Ubuntu_14 },
    { rid: "ubuntu.16.04-x64", runtime: Runtime.Ubuntu_16 },
    { rid: "linux-arm64", runtime: Runtime.Linux_ARM64 },
  ];

  for (const { rid, runtime } of targets) {
    await cleanServiceInstallFolder();
    await doOfflinePackage(rid, runtime, packageName);
  }
}

(async function main() {
  if (argv.mode === "online") {
    await runOnlinePackage();
  } else if (argv.mode === "offline") {
    await runOfflinePackage();
  } else {
    console.error("Invalid mode");
    process.exit(1);
  }
})();