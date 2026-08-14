-- TCP options, state and authorization 
create endpoint e1 authorization zzz as tcp(listener_port = 4022) for tsql()
create endpoint e1 state = started as tcp(listener_ip = all, listener_port = 4022) for tsql()

-- here we also test, that different grouping of ip parts recognized correctly
create endpoint e1 state = stopped as tcp(listener_ip = (1.2.3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 1.1.1 : 10.10.20. 30)) for tsql()

create endpoint e1 authorization zzz state = disabled as tcp(listener_ip = ('Some IpV6')) for tsql()

-- http specific options
create endpoint e1 as http(path = 'url', authentication =(basic), ports = (clear)) for tsql()
create endpoint e1 as http(authentication =(basic,digest,integrated,ntlm,kerberos), ports = (ssl)) for tsql()
create endpoint e1 as http(ports = (ssl,clear), site = '*', clear_port = 10, ssl_port = 20) for tsql()
create endpoint e1 as http(auth_realm='some realm', default_logon_domain='redmond', compression = disabled) for tsql()
create endpoint e1 as http(auth_realm=none, default_logon_domain=none, compression = enabled) for tsql()

-- soap language-specific stuff
create endpoint e1 as tcp(listener_port = 4022) for soap(webmethod 'n1'.'m1'(name='d1.dbo.n1'), 
	webmethod 'm2'(name='zzz', schema = none, format = none), batches = enabled)
create endpoint e1 as tcp(listener_port = 4022) for soap(webmethod 'm1'(name='zzz', schema = standard), 
	webmethod 'm2'(name='zzz', schema = default, format = all_results), batches = disabled)
create endpoint e1 as tcp(listener_port = 4022) for soap(webmethod 'm1'(name='zzz',format = rowsets_only), wsdl = none)
create endpoint e1 as tcp(listener_port = 4022) for soap(wsdl = default, sessions = enabled, login_type = mixed)
create endpoint e1 as tcp(listener_port = 4022) for soap(wsdl = 'sp_name', sessions = disabled, login_type = windows)
create endpoint e1 as tcp(listener_port = 4022) for soap(session_timeout = 10, database = 'db1', namespace = 'n1')
create endpoint e1 as tcp(listener_port = 4022) for soap(session_timeout = never, database = default)
create endpoint e1 as tcp(listener_port = 4022) for soap(namespace = default, schema = none, character_set = sql)
create endpoint e1 as tcp(listener_port = 4022) for soap(schema = standard, character_set = xml, header_limit = 1)

-- service broker/database mirroring specific arguments
create endpoint e1 as tcp(listener_port = 4022) for service_broker(authentication = windows)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(authentication = windows ntlm)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(authentication = windows kerberos certificate c1)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(authentication = certificate c1 windows)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(authentication = certificate c1 windows negotiate)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(encryption = disabled, message_forwarding = disabled)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(encryption = supported algorithm rc4)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(encryption = supported algorithm rc4 aes)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(encryption = required algorithm aes)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(encryption = required algorithm aes rc4)
create endpoint e1 as tcp(listener_port = 4022) for service_broker(message_forwarding = enabled, message_forward_size = 1)
create endpoint e1 as tcp(listener_port = 4022) for database_mirroring(authentication = windows, role = witness)
create endpoint e1 as tcp(listener_port = 4022) for data_mirroring(encryption = supported, role = partner)
create endpoint e1 as tcp(listener_port = 4022) for data_mirroring(role = all)
