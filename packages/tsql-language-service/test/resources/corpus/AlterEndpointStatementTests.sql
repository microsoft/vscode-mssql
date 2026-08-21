-- majority of options is covered in create endpoint tests, so, very small subset here
alter endpoint e1 affinity = none, state = started
alter endpoint e1 state = disabled, affinity = admin
alter endpoint e1 affinity = 1000000 as tcp (listener_port = 4022)

alter endpoint e1 for soap (add webmethod 'm1'(name = 'n1'), alter webmethod 'm2'(name = 'n2'))
alter endpoint e1 for soap (drop webmethod 'm1')