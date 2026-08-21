-- sacaglar: comments inline

-- test the lew version
RAISERROR (50005, 16, 1, @@JOB_ID, @@MIN_LVL, @@MAX_LVL)

RAISERROR (@err1, 16, @severity, 'hello', -10) WITH LOG

RAISERROR (-50005, -16, 1) WITH LOG, SETERROR, NOWAIT

RAISERROR('%s (%d)', @Severity, -1, @sMsg, @iErr)
