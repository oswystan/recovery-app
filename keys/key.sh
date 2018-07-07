#!/usr/bin/env bash
###########################################################################
##                     Copyright (C) 2018 wystan
##
##       filename: key.sh
##    description:
##        created: 2018-06-28 23:17:44
##         author: wystan
##
###########################################################################

openssl genrsa -out key.pem 2048
openssl req -new -x509 -key key.pem -out cert.pem -days 3650

###########################################################################
