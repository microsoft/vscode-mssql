@echo off
rem ---------------------------------------------------------------------------
rem  Cloud Deploy smoke harness — Windows shim for the synthetic replay tool.
rem  The WorkloadPlaybackValidator spawns replayCommand with shell:false and
rem  zero args, so replayCommand must be a single directly-executable file.
rem  This shim forwards stdin/stdout to fake-replay.mjs. Reference THIS file
rem  (not "node") as replayCommand in environments.json on Windows.
rem ---------------------------------------------------------------------------
node "%~dp0fake-replay.mjs"
