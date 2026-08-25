# Built-in routine documentation coverage

Date: 2026-08-25

The shared built-in registry currently recognizes 336 callable spellings. Of those, 294 have a
curated signature and description, so completion, hover, signature help, and argument-count
diagnostics can use the same contract. This is 87.5% signature coverage.

The audit used the public
[`MicrosoftDocs/sql-docs`](https://github.com/MicrosoftDocs/sql-docs/tree/df5bbb0999fa5f842145df6686fd4d127bc31c1e/docs)
snapshot at commit `df5bbb0999fa5f842145df6686fd4d127bc31c1e`. A spelling was documented only when a current public
reference supplied a callable syntax. Examples and mentions elsewhere in the documentation were not
treated as an API contract.

## Residual inventory

The following 42 spellings intentionally remain signatureless. They are still recognized so editor
features agree on their identity, but the language service does not invent parameter help or enforce
an argument count.

Legacy or publicly encountered spellings without a current callable reference:

- `DATABASEPROPERTY`
- `DEFAULT_DOMAIN`
- `IDENTITYPROPERTY`
- `IS_CALLERSIGNED`
- `PROGRAM_NAME`
- `SID_BINARY`
- `USER_SID`

Engine-internal or platform-specific spellings without a current public callable reference:

- `BCPCOLLATIONNAME`
- `BRICK_ID`
- `CLOUD_DATABASEPROPERTYEX`
- `COLLATIONNAME`
- `COLLATIONPROPERTYFROMID`
- `COLUMNPROPERTYEX`
- `COMPARECOMPRESSEDSCALARS`
- `COMPAREVARDECIMAL`
- `COMPRESSNUMERIC`
- `COMPRESSSCALAR`
- `CONVERTRESVTOSTRING`
- `DECOMPRESSNUMERIC`
- `DECOMPRESSSCALAR`
- `FAZUREADMINSESSION`
- `FEDERATION_FILTERING_VALUE`
- `GENDBNAMEFROMPATH`
- `GEN_NORM_TABLES`
- `GETBINARYSPARSEVECTOR`
- `GETCHECKSUM`
- `GETDEFAULT`
- `GET_CLOUD_PARTITION_MAX_SIZE`
- `GET_NEW_ROWVERSION`
- `NEWFILESTREAMVALUE`
- `NORMALIZE`
- `NORMALIZE_DENORMALIZE`
- `NT_CLIENT`
- `OBJIDUPDATE`
- `ODBCPREC`
- `ODBCSCALE`
- `PARTITION_FRAGMENT_ID`
- `PLATFORM`
- `RETRIEVEDBREPLICASTATE`
- `SQL_CONNECTION_MODE`
- `UNCOMPRESS`
- `XTYPETOTDS`

Move a spelling into the documented registry only when an authoritative source establishes its
parameters, optional arguments, return type, and engine or compatibility availability. If a name is
confirmed to be an implementation detail rather than supported T-SQL, remove it from recognition
instead.
