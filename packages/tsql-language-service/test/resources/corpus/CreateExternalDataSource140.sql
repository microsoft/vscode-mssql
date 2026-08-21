create external data source [My Blob Source]
with
( type = blob_storage, location = 'http://anyrandomlocation')

create external data source [MyBlobSource2]
WITH
(location = 'anything_goes_here', type = BLOB_storage,
credential = [My Credential]
)


create external data source [My Blob Source 2]
WITH
(location = 'anything_goes_here', type = BLOB_storage,
credential = [My Credential]
)

create external data source MyBlobSource3
WITH
(location = 'https://a/b/c/d',
type = blob_storage,
credential = MyCredential
)

