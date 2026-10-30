#!/bin/sh
# Runs before nginx starts. On the first start, creates a local certificate authority and
# a certificate for hqg-dashboard-https signed by it. Clients trust the CA through the
# "ca" volume: ca.pem alone, or ca-bundle.pem, which also holds the public CAs.
set -eu

KEYS=/etc/nginx/keys
CA=/etc/nginx/ca
[ -f "$KEYS/server.pem" ] && exit 0

echo "Creating the local certificate authority and the hqg-dashboard-https certificate"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj "/CN=HQG Dashboard local development CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout "$KEYS/ca.key" -out "$CA/ca.pem"

openssl req -newkey rsa:2048 -nodes -subj "/CN=hqg-dashboard-https" \
    -keyout "$KEYS/server.key" -out "$KEYS/server.csr"
openssl x509 -req -in "$KEYS/server.csr" -days 3650 \
    -CA "$CA/ca.pem" -CAkey "$KEYS/ca.key" -set_serial "0x$(openssl rand -hex 16)" \
    -extfile /dev/stdin -out "$KEYS/server.pem" <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:hqg-dashboard-https
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF
rm "$KEYS/server.csr"

cat /etc/ssl/certs/ca-certificates.crt "$CA/ca.pem" > "$CA/ca-bundle.pem"
