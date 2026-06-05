@echo off
rem Cloud Deploy smoke — extended replay shim (PASS mode). shell:false spawn needs a single
rem directly-executable file, so this .cmd wraps node and forwards stdin through.
node "%~dp0modal-replay.mjs" pass
