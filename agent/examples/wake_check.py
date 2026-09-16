#!/usr/bin/env python3
"""One model-free pending check; a platform hook decides whether to wake its worker.
No model SDK, agent prompt, or message-access credential belongs in this process.
"""
import json
import os
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(origin, key_file):
    url = urllib.parse.urlsplit(origin)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path not in ('', '/') or url.query or url.fragment):
        raise ValueError('invalid_origin')
    # Only a wake capability, in an owner-only regular file. Reject symlink paths.
    fd = os.open(key_file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd) as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
            raise ValueError('insecure_key_file')
        key = source.read(128).strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', key):
        raise ValueError('invalid_key')
    request = urllib.request.Request(origin.rstrip('/') + '/v1/wake',
                                     headers={'Authorization': 'Bearer ' + key})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
        payload = json.loads(response.read(1024))
    if set(payload) != {'pending'} or type(payload['pending']) is not bool:
        raise ValueError('invalid_response')
    return payload


def main():
    try:
        result = check(os.environ['DEEPEND_AGENT_ORIGIN'], os.environ['DEEPEND_WAKE_KEY_FILE'])
    except urllib.error.HTTPError as error:
        # Do not print request headers, response bodies or exceptions containing secrets.
        result = {'error': 'http_' + str(error.code)}
        if error.code == 429:
            value = error.headers.get('Retry-After', '60')
            result['retry_after_seconds'] = max(20, int(value)) if value.isdigit() else 60
        print(json.dumps(result))
        return 2
    except Exception:
        print(json.dumps({'error': 'wake_check_failed'}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
