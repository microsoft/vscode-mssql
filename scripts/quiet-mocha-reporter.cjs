"use strict";

const path = require("path");

class QuietMochaReporter {
    constructor(runner) {
        const failures = [];
        const skipped = [];
        let currentFile;
        let currentFileResult;

        runner.on("fail", (test, error) => {
            switchFile(test.file);
            failures.push({ test, error });
            recordFileResult("failed");
        });

        runner.on("pending", (test) => {
            switchFile(test.file);
            skipped.push(test);
            recordFileResult("skipped");
        });

        runner.on("pass", (test) => {
            switchFile(test.file);
            recordFileResult("passed");
        });

        runner.once("end", () => {
            printCurrentFileResult();

            if (skipped.length > 0) {
                process.stdout.write("\nSkipped:\n");
                skipped.forEach((test) => {
                    const title =
                        typeof test.fullTitle === "function" ? test.fullTitle() : test.title;
                    process.stdout.write(`- ${title}\n`);
                });
            }

            if (failures.length > 0) {
                process.stdout.write("\nFailures:\n");
                failures.forEach(({ test, error }, index) => {
                    const title =
                        typeof test.fullTitle === "function" ? test.fullTitle() : test.title;
                    process.stdout.write(`\n${index + 1}) ${title}\n`);
                    process.stdout.write(`${error?.stack ?? error}\n`);
                });
            }

            const { passes = 0, failures: failed = 0, pending = 0 } = runner.stats ?? {};
            process.stdout.write(`\n${passes} passed, ${failed} failed, ${pending} skipped\n`);
        });

        function switchFile(file) {
            if (!file || file === currentFile) {
                return;
            }

            printCurrentFileResult();
            currentFile = file;
            currentFileResult = {
                passed: 0,
                failed: 0,
                skipped: 0,
            };
        }

        function recordFileResult(status) {
            if (currentFileResult) {
                currentFileResult[status]++;
            }
        }

        function printCurrentFileResult() {
            if (!currentFile || !currentFileResult) {
                return;
            }

            const relativeFile = path.relative(process.cwd(), currentFile) || currentFile;
            const icon = currentFileResult.failed > 0 ? "\u2717" : "\u2713";
            process.stdout.write(
                `${icon} ${relativeFile} (${currentFileResult.passed} passed, ${currentFileResult.failed} failed, ${currentFileResult.skipped} skipped)\n`,
            );
        }
    }
}

module.exports = QuietMochaReporter;
