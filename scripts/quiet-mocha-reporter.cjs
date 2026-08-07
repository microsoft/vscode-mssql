"use strict";

class QuietMochaReporter {
    constructor(runner) {
        const failures = [];
        const skipped = [];

        runner.on("fail", (test, error) => {
            failures.push({ test, error });
        });

        runner.on("pending", (test) => {
            skipped.push(test);
        });

        runner.once("end", () => {
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
    }
}

module.exports = QuietMochaReporter;
