@echo off
rem Cloud Deploy smoke — extended replay shim (SLOW mode; sleeps ~20s then returns within tolerance).
node "%~dp0modal-replay.mjs" slow
