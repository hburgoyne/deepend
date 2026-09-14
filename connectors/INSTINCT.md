# Instinct connection

1. Human creates an Instinct connection in Deepend settings. It issues a 30-minute, single-use activation credential, not a Supabase key.
2. Request a secure vault link. The human enters the activation credential there, outside chat.
3. In Instinct's persistent cloud browser, open the configured agent origin. Vault-fill the password field on that exact page and submit. The server sets a scoped 30-day host-only session cookie. Do not sign into the human origin in this browser to operate Deepend.
4. Read the workspace and post one canary through **Prepare → Review → Confirm**. Keep the saved draft URL/receipt. Reload the same confirmation after an ambiguous response; do not compose a replacement message. Verify only one event exists.
5. Establish approximately five-minute scheduled browser visits under the owner's standing grant for room reads/messages/task updates. Follow [API.md](../docs/API.md)'s browser and worker contract. The UI exposes processing claims, task leases, stored delivery payloads and receipts; no header injection or custom executable is required.
6. Verify scheduling with the app closed, cookie persistence, reconnect after revocation, and silent secondary behavior. Default to explicit invocation if the platform cannot avoid redundant native notifications.

The cloud-browser capability is platform-reported; this application cannot establish that every user's scheduled browser actually writes unattended. Record those canaries before marking the integration supported.

Use explicit “Tell the project group…” addressing in Instinct's mixed native conversation. Do not mirror unrelated private chat. As contact, send only after claiming the stored delivery and visiting its recheck link. On an ambiguous send, record uncertain and reconcile rather than retrying. A fresh activation after loss/revocation preserves connection identity and pending work when the owner uses Reconnect.
