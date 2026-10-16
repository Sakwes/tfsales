#!/usr/bin/env python3
"""Pinned-development DNS/TCP/PostgreSQL TLS probe. No authentication or SQL."""
import argparse
import os
import socket
import ssl
import struct
from target import SESSION_HOST, endpoint, trusted_root


def tls_context(host, *, supabase_root_2021_compat=False):
    if supabase_root_2021_compat and (
        host != SESSION_HOST or not os.environ.get('DEV_DB_SSLROOTCERT')
    ):
        raise ValueError('Compatibility requires Session Pooler and an explicit trusted CA file')
    context = ssl.create_default_context(cafile=trusted_root())
    if supabase_root_2021_compat:
        # Python 3.13+ adds strict CA extension checks that libpq does not
        # request. Retain CERT_REQUIRED, check_hostname and all other flags.
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--supabase-root-2021-compat', action='store_true',
                        help='explicit opt-in: omit strict CA extension checks; chain/hostname verification stays enabled')
    args = parser.parse_args()
    if not args.probe:
        print('PLAN ONLY: no network probe; --probe sends only PostgreSQL SSLRequest/TLS')
        return 0
    try:
        host, _ = endpoint()
        context = tls_context(host, supabase_root_2021_compat=args.supabase_root_2021_compat)
    except (ValueError, OSError):
        print('STOP: invalid development endpoint or trusted certificate configuration')
        return 1
    if args.supabase_root_2021_compat:
        print('COMPATIBILITY: VERIFY_X509_STRICT disabled; certificate-chain and hostname verification enabled')
    addresses = []
    for family, label in ((socket.AF_INET, 'IPv4'), (socket.AF_INET6, 'IPv6')):
        try:
            found = socket.getaddrinfo(host, 5432, family=family, type=socket.SOCK_STREAM)
            addresses.extend(found)
            print('DNS', label, 'resolved; address count:', len(found))
        except OSError as error:
            print('DNS', label, 'unavailable:', type(error).__name__, 'errno:', error.errno)
    if not addresses:
        print('BLOCKED: DNS; TCP and TLS not attempted')
        return 1
    for family, kind, protocol, _, address in addresses:
        stage = 'TCP'
        try:
            with socket.socket(family, kind, protocol) as raw:
                raw.settimeout(5)
                raw.connect(address)
                print('PASS: TCP 5432 reachable')
                stage = 'PostgreSQL SSLRequest'
                raw.sendall(struct.pack('!II', 8, 80877103))
                if raw.recv(1) != b'S':
                    print('BLOCKED: PostgreSQL TLS negotiation refused')
                    continue
                stage = 'TLS verification'
                with context.wrap_socket(raw, server_hostname=host) as secured:
                    print('PASS: verified TLS hostname/certificate; protocol:', secured.version())
                    print('No credentials, authentication, queries or writes sent')
                    return 0
        except OSError as error:
            print('BLOCKED:', stage, type(error).__name__, 'errno:', error.errno)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
