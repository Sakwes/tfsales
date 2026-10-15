#!/usr/bin/env python3
"""Future opt-in Auth API contract tests, synthetic users only; default is offline."""
import argparse
import base64
import json
import os
import secrets
import time
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from uuid import uuid4
from target import PROJECT_REF, API_URL


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected redirect refused')


def validate(env):
    if env.get('VITE_SUPABASE_URL','').rstrip('/') != API_URL or env.get('DEV_PROJECT_REF') != PROJECT_REF:
        raise ValueError('Development project identity required')
    key=env.get('DEV_AUTH_ADMIN_JWT','')
    try:
        part=key.split('.')[1]
        claims=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))
        if claims['role']!='service_role' or claims['ref']!=PROJECT_REF or claims['exp']<=time.time():
            raise ValueError('Wrong development key identity')
    except Exception:
        raise ValueError('A development-only service-role JWT with matching project and expiration is required') from None
    if not env.get('VITE_SUPABASE_PUBLISHABLE_KEY'):
        raise ValueError('Development publishable key required')
    return key


def run():
    admin=validate(os.environ)
    publishable=os.environ['VITE_SUPABASE_PUBLISHABLE_KEY']
    opener=build_opener(NoRedirect())
    created=[]
    def call(path,method='GET',body=None,bearer=None):
        assert path.startswith(('/auth/v1/','/rest/v1/'))
        headers={'apikey':publishable,'Content-Type':'application/json'}
        if bearer:headers['Authorization']='Bearer '+bearer
        request=Request(API_URL+path,method=method,headers=headers,
                        data=json.dumps(body).encode() if body is not None else None)
        with opener.open(request,timeout=20) as response:
            data=response.read()
            return json.loads(data) if data else None
    try:
        for _ in range(2):
            password=secrets.token_urlsafe(32)
            email='sellnova-auth-'+uuid4().hex+'@example.test'
            user=call('/auth/v1/admin/users','POST',{'email':email,'password':password,
                'email_confirm':True,'user_metadata':{'sellnova_synthetic_test':True}},admin)
            user_id=str(user['id']); created.append(user_id)
            session=call('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password})
            token=session['access_token']
            identity=call('/auth/v1/user',bearer=token)
            assert identity['id']==user_id and identity['email']==email
            profiles=call('/rest/v1/profiles?select=id,phone&id=eq.'+user_id,bearer=token)
            roles=call('/rest/v1/user_roles?select=role&user_id=eq.'+user_id,bearer=token)
            assert len(profiles)==1 and profiles[0]['phone'] is None
            assert {'role':'seller'} in roles and {'role':'admin'} not in roles
            try:call('/auth/v1/token?grant_type=password','POST',{'email':email,'password':'deliberately-wrong-synthetic-password'})
            except HTTPError as error:assert error.code in (400,401)
            else:raise AssertionError('Invalid password accepted')
            call('/auth/v1/logout','POST',bearer=token)
        print('PASS: two synthetic email-first Auth users; login/session/profile/default-role/invalid-password/logout contracts')
    finally:
        for user_id in created:
            user=call('/auth/v1/admin/users/'+user_id,bearer=admin)
            if user.get('email','').endswith('@example.test') and user.get('user_metadata',{}).get('sellnova_synthetic_test') is True:
                call('/auth/v1/admin/users/'+user_id,'DELETE',bearer=admin)
            else:raise ValueError('Cleanup refused for untagged user')


def main():
    if not __debug__:
        raise RuntimeError('Tests must run without Python optimization')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true')
    args=parser.parse_args()
    if not args.run:
        print('PREPARED ONLY: no Auth API calls; explicit approval required')
        return 0
    if os.environ.get('DEVDB_AUTH_TEST_APPROVAL')!='RUN-AUTH-SYNTHETIC-'+PROJECT_REF:
        print('STOP: explicit synthetic Auth API test approval required')
        return 1
    try:run()
    except Exception as error:
        print('FAIL:',type(error).__name__,'(details suppressed; check only tagged synthetic fixtures if cleanup failed)')
        return 1
    return 0


if __name__=='__main__':
    raise SystemExit(main())
