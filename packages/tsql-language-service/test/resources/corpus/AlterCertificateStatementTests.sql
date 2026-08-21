alter certificate c1 remove private key
alter certificate c1 with active for begin_dialog = on
-- private key options are tested in Create Certificate tests
alter certificate c1 with private key (file = 'zzz') 

-- undocumented stuff
alter certificate c1 remove attested option
alter certificate c1 attested by 'zzz'