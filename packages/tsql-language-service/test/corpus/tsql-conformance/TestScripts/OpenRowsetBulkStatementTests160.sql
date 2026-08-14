SELECT *
FROM OPENROWSET(
      PROVIDER = 'CosmosDB',
      CONNECTION = 'Account=synapselink-cosmosdb-sqlsample;Database=db1',
      OBJECT = 'a',
      CREDENTIAL = 'MyCredential'
    ) with ( date_rep varchar(20), cases bigint, geo_id varchar(6) ) as rows;

SELECT *
FROM OPENROWSET(
      PROVIDER = 'CosmosDB',
      CONNECTION = 'Account=synapselink-cosmosdb-sqlsample;Database=db2',
      OBJECT = 'b',
      CREDENTIAL = 'MyCosmosDbAccountCredential'
    ) as rows;

SELECT *
FROM OPENROWSET(
      PROVIDER = 'CosmosDB',
      CONNECTION = 'Account=synapselink-cosmosdb-sqlsample;Database=db3',
      OBJECT = 'c d',
      SERVER_CREDENTIAL = 'My Server Credential'
    ) with ( date_rep varchar(20), cases bigint) as rows;
	
SELECT *
FROM OPENROWSET(
      PROVIDER = 'CosmosDB',
      CONNECTION = 'Account=synapselink-cosmosdb-sqlsample;Database=mydb',
      OBJECT = 'object'
    ) with ( date_rep varchar(20), cases bigint) as rows;

SELECT *
FROM OPENROWSET(
      PROVIDER = 'CosmosDB',
      CONNECTION = 'Account=synapselink-cosmosdb-sqlsample;Database=mydb',
      OBJECT = 'object'
    );

SELECT TOP 100 UserID FROM OPENROWSET(BULK 'path', FORMAT = 'SStream',PARSER_VERSION = '2.0') AS a;

SELECT TOP 10 * FROM OPENROWSET(
      'CosmosDB',
      'Accnt',
       myTable
    ) with ( date_rep varchar(20), cases bigint, geo_id varchar(6) ) as rows;

SELECT TOP 10 * FROM openrowset ('CosmosDB', 'x', t) with (a VARCHAR (20), b BIGINT, c VARCHAR (6));