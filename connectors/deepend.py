#!/usr/bin/env python3
"""Reference API client for an operator-controlled runtime; no chat secrets."""
import argparse, json, os, stat, sys, uuid
from pathlib import Path
from urllib.parse import urlsplit, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
READS = {'state', 'events', 'receipt', 'delivery.check'}
WRITES = {'message', 'batch.claim', 'batch.finish', 'task.create', 'task.claim', 'task.update', 'task.renew', 'delivery.prepare', 'delivery.claim', 'delivery.result'}
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('operation', choices=sorted(READS | WRITES))
    p.add_argument('--input', type=Path)
    p.add_argument('--after', type=int)
    p.add_argument('--request-id')
    a = p.parse_args()
    origin = os.environ['DEEPEND_ORIGIN']
    url = urlsplit(origin)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError('exact_https_origin_required')
    credential_path = Path(os.environ['DEEPEND_TOKEN_FILE'])
    mode = credential_path.stat().st_mode
    if not stat.S_ISREG(mode) or stat.S_IMODE(mode) & 0o077:
        raise ValueError('credential_file_must_be_private')
    credential = credential_path.read_text().strip()
    if len(credential) != 43 or not all(c.isalnum() or c in '_-' for c in credential):
        raise ValueError('invalid_credential_format')
    body = json.loads(a.input.read_text()) if a.input else {}
    if not isinstance(body, dict): raise ValueError('object_required')
    if a.after is not None: body['after'] = a.after
    headers = {'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'}
    target = origin + '/v1/' + a.operation
    data = None
    if a.operation in READS:
        if body: target += '?' + urlencode(body)
    else:
        if not a.request_id: raise ValueError('persisted_request_id_required')
        headers['Idempotency-Key'] = str(uuid.UUID(a.request_id))
        data = json.dumps(body).encode()
    try:
        with build_opener(NoRedirect()).open(Request(target, data=data, headers=headers), timeout=25) as response:
            print(json.dumps(json.load(response)))
    except HTTPError as e:
        # Never print the request, headers, response body, or credential.
        print(json.dumps({'http_status': e.code, 'retry_after': e.headers.get('Retry-After')}))
        return 1
    except URLError:
        print(json.dumps({'error': 'transport_uncertain', 'instruction': 'Inspect receipt or retry the same request ID.'}))
        return 1
    return 0
if __name__ == '__main__':
    try: sys.exit(main())
    except (ValueError, KeyError, OSError):
        print(json.dumps({'error': 'invalid_local_configuration_or_input'}))
        sys.exit(2)
