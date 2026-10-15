#!/usr/bin/env python3
"""Exact-development DNS/TCP/PostgreSQL TLS probe. No authentication or SQL."""
import argparse
import os
import socket
import ssl
import struct
from target import DB_HOST, API_URL


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe',action='store_true')
    args=parser.parse_args()
    if not args.probe:
        print('PLAN ONLY: no network probe; --probe sends only PostgreSQL SSLRequest/TLS')
        return 0
    if os.environ.get('VITE_SUPABASE_URL','').rstrip('/')!=API_URL:
        print('STOP: explicitly injected development API URL required')
        return 1
    try:
        addresses=socket.getaddrinfo(DB_HOST,5432,type=socket.SOCK_STREAM)
    except OSError as error:
        print('BLOCKED: development database DNS',type(error).__name__)
        return 1
    print('Development database DNS resolved; address count:',len(addresses))
    root=os.environ.get('DEV_DB_SSLROOTCERT','/etc/ssl/certs/ca-certificates.crt')
    context=ssl.create_default_context(cafile=root)
    for family,kind,protocol,_,address in addresses[:4]:
        try:
            with socket.socket(family,kind,protocol) as raw:
                raw.settimeout(5)
                raw.connect(address)
                print('Development database TCP reachable')
                raw.sendall(struct.pack('!II',8,80877103))
                if raw.recv(1)!=b'S':
                    print('BLOCKED: PostgreSQL TLS negotiation refused')
                    continue
                with context.wrap_socket(raw,server_hostname=DB_HOST) as secured:
                    print('PASS: verified database TLS hostname/certificate; protocol:',secured.version())
                    print('No credentials, PostgreSQL startup/authentication, queries or writes sent')
                    return 0
        except OSError as error:
            print('BLOCKED:',type(error).__name__,'errno:',error.errno)
    return 1


if __name__=='__main__':
    raise SystemExit(main())
