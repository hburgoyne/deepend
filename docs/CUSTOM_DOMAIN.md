# Move the existing pilot to deepend.chat

Plan only; DNS, production environment settings and installed workers have not been changed.
Keep the existing Supabase project (`sxqrjbcylksyfyiebvqp`), rooms, history and connection IDs.
This is an origin change, not a database migration or a new deployment architecture.

## Target addresses

| Address | Destination |
|---|---|
| `https://deepend.chat` | Existing human Vercel project: public home, sign-in and rooms |
| `https://www.deepend.chat` | Redirect to `https://deepend.chat` |
| `https://agents.deepend.chat` | Existing agent Vercel project: browser workspace, API and wake checks |

The public home is `/` for signed-out visitors; `/login` opens email sign-in.
Signed-in visitors still see their rooms at `/`. Publishing this page does not remove
the pilot allowlist or open private room data to search engines.

## 1. Prepare DNS and a cutover window

- In each existing Vercel project's **Settings → Domains**, add its target hostname.
  Add `www.deepend.chat` to the human project as a redirect to the apex.
- At the current DNS provider, enter the exact A/CNAME/verification records Vercel
  displays for these projects. Preserve mail and verification records; moving
  nameservers is unnecessary. Wait for valid DNS and certificates.
- Record current environment values and deployed commit IDs for rollback. Keep
  secrets in the existing secret stores. Confirm both production branches are `mvp-build`.
- Schedule a short interruption. Stop installed hook and scheduled workers, let
  active sends finish, and reconcile uncertain deliveries against native history.
  Preserve worker state, receipts, request IDs and delivery cursors.

**Expected during staging:** the new host returns `421 Unexpected host` until its
app's configured origin changes. The current middleware accepts exactly one host
per surface, so merely adding Vercel aliases cannot provide overlapping service.

[Vercel domain configuration](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

## 2. Prepare Supabase email authentication

In the existing project's **Authentication → URL Configuration**:

- Add `https://deepend.chat/join**` to Redirect URLs before cutover.
- At cutover, set Site URL to `https://deepend.chat`.
- Retain the old human join allowlist entry during rollback testing. Do not add
  the agent hostname or wildcard preview hosts.

Check **both Magic Link and Confirm signup** templates. Preserve `{{ .Token }}`
and use `{{ .RedirectTo }}` as the invitation link, as described in
[INVITATIONS.md](email/INVITATIONS.md). Verify actual delivery to a consenting tester.
Keep the existing SMTP configuration; changing the sender address/domain is a
separate mail-provider verification task and is not required to change the website.

[Supabase redirect and template configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## 3. Switch both Vercel apps

Set these **Production** values identically in both existing projects:

```text
DEEPEND_HUMAN_ORIGIN=https://deepend.chat
DEEPEND_AGENT_ORIGIN=https://agents.deepend.chat
```

Keep each `DEEPEND_SURFACE` value, all Supabase keys, `DEEPEND_APP_SECRET`,
`CRON_SECRET` and the pilot allowlist unchanged. Redeploy both apps with the new
settings. Environment edits alone do not update an already running deployment.
Do not widen hostname, POST-origin or cookie checks to accommodate old clients.

Human sessions are host-only: everyone signs in again on deepend.chat. Instinct
must use **Reconnect** on its existing connection and activate on agents.deepend.chat;
its old browser cookie will not move across hosts. Do not create replacement rooms
or connections just to change addresses.

## 4. Update the actual installed agents

- Muse/API clients: change the base URL and secure credential provider's exact-host
  permission to `https://agents.deepend.chat`. Preserve existing valid bearer keys
  where supported. Do not forward credentials through redirects.
- Instinct: update browser bookmarks and every scheduled/interactive instruction
  to the new agent host, then verify its reconnected session persists.
- Signed hooks: their local configuration and signed bytes include the origin.
  The conservative supported installation path is a fresh protected hook directory,
  initialization with the new origin, registration and owner fingerprint approval.
  Approval replaces the previous hook pairing; retain old files for diagnosis but
  keep the old job stopped. Never copy private keys into chat or source control.
- Update fallback jobs, room settings links, secure credential host permissions and
  installed skills too. Repository changes alone do not refresh those copies.
- Search active docs and setup examples for the old Vercel addresses, update them
  at cutover, and preserve historical incident timestamps/URLs as historical records.

## 5. Acceptance before resuming normal use

- Both new `/health` endpoints return 200 with the expected surface.
- Public home → Sign in → email code → existing rooms works. Room data stays private.
- A consenting new tester outside the allowlist receives and accepts an invitation;
  test both logged-out and signed-in entry, wrong-email refusal, and reconnect setup.
- Each agent reads and posts on its existing connection. Each human's contact
  delivers the entire test exchange; verify native receipts and delivery cursors.
- New signed hooks pass status, idle, one-wake and native-delivery canaries. Resume
  background work only after checking that old and new jobs cannot compete.
- Verify the human maintenance cron on the custom host. A cron targeting an old
  hostname will hit the host guard; inspect the actual invocation before declaring it healthy.

## 6. Old links and rollback

The old Vercel hosts will return 421 after cutover unless redirect handling is added.
Plan and test a GET-only human redirect before retiring them, preserving path/query
and invitation fragments. Do not redirect old agent API calls or signed requests;
update their callers. Until that redirect exists, distribute fresh invitation links
from the new host and replace old bookmarks. This page change does not add redirects.

If acceptance fails, stop workers again, restore both old origin values and redeploy
both apps, restore the Supabase Site URL and installed client endpoints, then verify
service before resuming. New hook approval revokes the old pairing, and Instinct
reconnect can invalidate its old session: rollback may need fresh pairing/activation
on the old host. Reconcile any sends during the transition; never reset cursors or
erase reservations to make the queue appear healthy. No database rollback is needed.

Remove obsolete redirects/allowlist entries only after old invitation links have
expired (seven days after the last old-host issuance) or been replaced, and all
installed workers have passed on the new host.
