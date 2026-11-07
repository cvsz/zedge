#!/bin/sh
# git GPG-signing wrapper.
#
# Supplies the commit signing passphrase non-interactively from the GPG_PASS
# environment variable on file descriptor 3, leaving stdin free for the payload
# git feeds to gpg. Requires gpg-agent `allow-loopback-pinentry` (set in
# ~/.gnupg/gpg-agent.conf) and `gpg.program` pointing here.
#
# Usage (set once, locally):
#   git config gpg.program "$PWD/scripts/git-gpg-sign.sh"
#   git config commit.gpgsign true
#   export GPG_PASS="..."
#   git commit -S -m "message"
#
if [ -z "${GPG_PASS}" ]; then
    echo "git-gpg-sign: GPG_PASS environment variable is not set" >&2
    exit 1
fi

/usr/bin/gpg --pinentry-mode loopback --passphrase-fd 3 "$@" 3<<GPG_PASS_EOF
${GPG_PASS}
GPG_PASS_EOF
