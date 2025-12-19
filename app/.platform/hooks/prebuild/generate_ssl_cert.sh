#!/bin/bash

openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/C=US/ST=Wisconsin/L=Madison/O=Education Analytics/OU=Starting Blocks/CN=self.signed.cert"
mv cert.pem /etc/pki/tls/certs/server.crt
mv key.pem /etc/pki/tls/certs/server.key
chmod 400 /etc/pki/tls/certs/server.crt
chmod 400 /etc/pki/tls/certs/server.key