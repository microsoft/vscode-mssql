CREATE EXTERNAL DATA SOURCE eds1
    WITH (
    LOCATION = 'protocol://ip_address:port'
    );

CREATE EXTERNAL DATA SOURCE eds2
    WITH (
    LOCATION = 'protocol://ip_address:port',
    CREDENTIAL = testCredential
    );