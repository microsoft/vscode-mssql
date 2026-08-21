-- sacaglar: comments inline.

open symmetric key [key1] decryption by certificate c1 
open symmetric key [key1] decryption by certificate [c1] with password = 'p1'
open symmetric key [key1] decryption by asymmetric key [ak1]
open symmetric key [key1] decryption by asymmetric key ak1 with password = N'p1'
open symmetric key [key1] decryption by symmetric key sk1
open symmetric key [key1] decryption by password = 'password'