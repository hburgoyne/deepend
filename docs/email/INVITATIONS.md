# Email-bound room invitations

## Supabase email configuration (owner-managed)

In Authentication → Email Templates, update **both Magic Link and Confirm signup**.
Keep the existing sign-in code (`{{ .Token }}`) and security instructions. Add:

```html
<p><a href="{{ .RedirectTo }}">Open Deepend to sign in or review your invitation</a></p>
```

Keep the subject “Your Deepend sign-in code” (the invite uses the same email service).
Do not use `{{ .ConfirmationURL }}`: Deepend verifies the typed code. Do not alter
Change email / Reset password for this feature. Existing custom SMTP is reused.

Add this URL under Authentication → URL Configuration → Redirect URLs:

```
https://deepend-human.vercel.app/join**
```

The template link opens the same `/join#TOKEN` link that the administrator can copy.
The fragment is exchanged for a Secure HttpOnly cookie by a same-origin POST, then
removed from browser history. It is not an authentication credential: acceptance also
requires an independently verified session for the invited email and a Join click.
Supabase receives the redirect URL to render in the email. No token is placed in a
Deepend request URL, analytics event, or application log.

## Behavior

- Admin enters email, optionally chooses a fresh room, then emails the link. No
  extra 15-minute re-verification. Seven-day expiry, copy/resend/revoke controls.
- Supabase `signInWithOtp` handles both new and existing users. Mail status “accepted”
  means the service accepted the request, not that an inbox received it. A timeout
  is uncertain; check the inbox before an explicit resend, which may replace the code.
- Valid invitations temporarily permit enrollment for that email. Active members can
  sign in again after invitation consumption. The global pilot allowlist is unchanged.
- Signing in resumes the invitation; wrong-account users must switch accounts.
  GET requests never join. POST Join is idempotent and activates membership immediately.
- A fresh room contains only the inviter initially: no copied history, tasks, people,
  contact assignments or credentials. Both people connect agents in that new room.
- Setup order: paste instructions, supply credential when the agent requests secure
  entry, check connection status. The first contact checkbox is selected visibly and
  assigned atomically if no contact exists; adding an agent never replaces a contact.
- Reconnect, privilege changes and destructive actions retain fresh verification.
  Legacy code invitations remain usable under their original pending-approval rules.

## Live acceptance

After template configuration, invite a consenting tester outside the pilot allowlist.
Verify: email contains the copyable room link and code; logged-out click → code entry
→ join confirmation → agent choice. Already-signed-in click should skip code entry.
Forwarding the link to another email must not grant access. Retry Join without a
second membership; revoke/expire another invite and confirm refusal. Test fresh-room
creation and confirm the original transcript remains. Check both agent types and the
instructions-first order. Never use real recipients for unattended test email sends.
