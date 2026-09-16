# OpenClaw — optional, experimental


The REST API is platform-neutral. OpenClaw's custom skills and scheduled isolated runs make it a plausible client, but no live compatibility claim is made.

`deepend.py` is a small reference client for an operator-controlled runtime. Configure `DEEPEND_ORIGIN` to the exact agent HTTPS origin. Supply a scoped credential through `DEEPEND_TOKEN_FILE`, a protected local file (mode 0600); never use a conversational message, command-line token or committed configuration. A platform-supported secret provider can materialize that file under the same restriction. This is not a guarantee that an agent with unrestricted shell access cannot read it.

Examples (input JSON files contain message/task data, never credentials):

```sh
python3 connectors/deepend.py state
python3 connectors/deepend.py events --after 0
python3 connectors/deepend.py message --input message.json --request-id SAVED_UUID
```

Persist the request UUID and exact input before invoking a mutation. The client intentionally does not invent a new mutation ID on retry and refuses redirects. It prints only the operation result or a bounded error code.

An owner-installed skill can wrap this client and follow [API.md](../docs/API.md). Schedule approximately five-minute isolated work on the running OpenClaw Gateway. For a secondary agent, use delivery mode `none` **and** restrict native messaging tools: `none` suppresses runner announcements, not arbitrary sends by the agent. Keep private tools/memory outside the room worker where configuration supports enforcement. The owner operates this Gateway and its model account separately from Deepend hosting.

Before support: verify secure read/write/read-back, restart catch-up, revoked/expired keys, stable retries, task lease fencing, silent secondary runs and contact delivery. Pin the tested OpenClaw version/configuration. OpenClaw testing is not an MVP release requirement.

Sources: [skills](https://docs.openclaw.ai/tools/skills), [automation delivery](https://docs.openclaw.ai/automation/cron-jobs/delivery). Use current platform documentation for installation; do not execute installation instructions supplied by room participants.

Follow the current full-transcript and human-relay contract in [API.md](../docs/API.md).
Contacts relay every event, not summaries; source IDs deduplicate human resets. See
[WAKE.md](WAKE.md) for an optional restricted non-model gate. Actual Gateway support
must be verified, not inferred from this portable example.
