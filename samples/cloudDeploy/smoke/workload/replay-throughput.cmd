@echo off
rem Cloud Deploy smoke — extended replay shim (THROUGHPUT + error-rate regression mode).
node "%~dp0modal-replay.mjs" throughput
