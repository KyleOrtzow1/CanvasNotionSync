# "Sign in with Notion": why setup still pastes a token

Findings for [#63](../../issues/63). Investigated 2026-09-17 against the Notion
API as it stands today.

## Verdict

**Not viable without running a server, and we should not run one for this.**

Notion's public-integration OAuth flow authenticates the client at the token
endpoint with a client secret over HTTP Basic, and publishes no PKCE support
for that endpoint. A Chrome extension cannot hold a secret — the bundle is a
ZIP anyone can download from the Web Store and unzip — so the authorization
code can only be exchanged by something we host. That is the blocking
constraint, and it is not one we can code around from inside the extension.

The manual internal-integration token stays. What should change instead is the
step people actually get wrong, which is sharing the database with the
integration; see [Worth doing instead](#worth-doing-instead).

## What setup costs today

Three steps, all in the popup's guided setup (`popup.html`, `setupStep1`
through `setupStep3`):

1. Create an internal integration at notion.so/my-integrations, reveal the
   `ntn_` access token, paste it.
2. Create a database, open **•••  > Connections**, search for "Canvas Sync",
   add it, then copy the database URL and paste that.
3. Press **Set Up Database**, which reconciles columns via
   `planAssignmentSchemaUpdate()` and runs the first sync.

Step 2 is the failure. Missing the **Connections** part leaves a database that
exists and a token that is valid, and the sync fails with the message in
`src/handlers/background-handlers.js:491` — "Could not find that database, or
the integration cannot access it". Notion returns the same 404 for "no such
database" and "not shared with you", so the extension cannot tell the user
which of the two happened.

## What OAuth would have bought us

- No token paste. The user presses a button and approves in Notion.
- **The page picker replaces step 2's Connections dance.** Notion's
  authorization screen has the user select the pages the integration may
  touch, and access is granted as part of the same flow. The most common
  support failure stops being possible.
- The token response carries `workspace_id`, `workspace_name`, `bot_id` and
  `owner`, and `duplicated_template_id` when the integration ships a template
  — so we could learn the target database ID from the flow instead of asking
  for a pasted URL.

That is a real improvement. It is worth being clear that the flow is blocked on
mechanics, not on value.

## The blocking constraint

Notion's authorization code flow (developers.notion.com/docs/authorization):

- Authorize at `https://api.notion.com/v1/oauth/authorize` with `client_id`,
  `redirect_uri`, `response_type=code`, `owner=user`, and an optional `state`.
- Exchange at `https://api.notion.com/v1/oauth/token` with
  `grant_type=authorization_code` and the `code`, **authenticating the client
  with HTTP Basic `client_id:client_secret`**.

There is no documented `code_challenge` / `code_verifier` for that endpoint,
and `api.notion.com` serves no OAuth authorization-server metadata to advertise
one — `https://api.notion.com/.well-known/oauth-authorization-server` answers
`400 invalid_request_url`, not a discovery document.

So the exchange needs the secret, and the extension cannot keep one. Anyone who
extracts it can impersonate our integration against every workspace that ever
authorized it. A secret shipped to clients is a disclosed secret, and rotating
it breaks every install at once.

`chrome.identity.launchWebAuthFlow` is not the problem here. It would handle
the authorize leg fine, with a
`https://<extension-id>.chromiumapp.org/` redirect URI registered on the Notion
side. The token leg is what has nowhere to run.

## Options considered

**A. Ship the client secret in the extension.** Rejected. See above — this is
disclosing a credential that grants access to other people's workspaces, and no
amount of obfuscation changes that.

**B. Host a token-exchange endpoint.** Technically the standard answer: a small
service holds the secret, receives the code, returns the access token. It works
and it is what every other extension in this position does. It is rejected here
on ownership rather than on engineering — it means a service to deploy, keep
up, and pay for; a new party in the data path, which contradicts a promise
already published — `docs/privacy-policy.html` states that "there is no server
operated by the Extension developer in between"; and an outage mode where
nobody can complete setup because our box is down. This is the owner's call, not one to
make in code — see [What needs a human](#what-needs-a-human).

**C. Notion's hosted MCP server.** Notion does operate an OAuth surface that a
public client can use unaided. `https://mcp.notion.com/.well-known/oauth-authorization-server`
advertises `code_challenge_methods_supported: ["plain", "S256"]`,
`token_endpoint_auth_methods_supported` including `"none"`, and dynamic client
registration (RFC 7591) at `https://mcp.notion.com/register`. PKCE plus a
public client plus no pre-registered secret is exactly the shape that would
unblock an extension.

It is still the wrong tool. That authorization server issues tokens for
`mcp.notion.com`, not for `api.notion.com` — an MCP token does not authorize
the REST calls in `src/api/notion-api.js`. Adopting it means re-expressing
every query, page create and page update as MCP tool calls against a server
whose tool surface is not a stable API contract, and giving up the rate-limit
behaviour `NotionRateLimiter` is built around. Rewriting the entire Notion data
layer to avoid a token paste is not a trade worth making.

**D. Keep the pasted token and fix the actual pain.** Recommended.

## Worth doing instead

The token paste is two fields and a copy. The thing that breaks setups is the
silent sharing step, and that is addressable without OAuth:

- **Tell the two 404s apart.** After a database fetch 404s, `GET /v1/users/me`
  distinguishes a dead token from a live token that cannot see the database,
  and `POST /v1/search` shows what the integration *can* see. An empty search
  result alongside a valid token is "you haven't shared anything with Canvas
  Sync yet" — a different sentence from the one at
  `background-handlers.js:491`, and an actionable one.
- **Check it during setup, not on first sync.** The same probe run when the
  database URL is pasted catches the mistake while the user is still in the
  setup accordion with Notion open in the next tab.

Neither needs a manifest change, a new permission, or a server. Suggested as a
follow-up issue; deliberately not implemented here, since #63 asked for a
decision and this is a different change.

## If B is ever chosen, this is the cost

Recorded so the decision isn't re-derived later:

- `identity` permission in `manifest.json`, **and** the matching entry in
  `ALLOWED_PERMISSIONS` in `.github/scripts/check-manifest-security.cjs` —
  `npm run check:security` fails the build otherwise, by design.
- `host_permissions` and CSP `connect-src` entries for the exchange host.
  `https://api.notion.com` is already in both; the hosted endpoint would not
  be, and the manifest check requires HTTPS.
- The redirect URI is derived from the extension ID, so the unpacked
  development build and the Web Store build have different ones. Both must be
  registered on the Notion integration.
- **Token rotation.** Public-integration tokens refresh via
  `grant_type=refresh_token`, which returns a new access token *and a new
  refresh token*. Today's internal-integration token never expires, so nothing
  in `CredentialManager` or the sync path handles a token changing underneath
  it. Refresh-on-401, persisting the rotated pair, and not losing it when two
  syncs race would all be new work.
- Migration: the stored `ntn_`/`secret_` token keeps working. Existing users
  are not re-onboarded, and the manual path stays in the popup for
  self-hosted/locked-down workspaces.
- Chrome Web Store review: a new permission plus a new remote endpoint means a
  fresh justification and a slower review. Notion also reviews public
  integrations for security and privacy before listing.

## What needs a human

The owner decides whether this project is willing to run and pay for a
token-exchange service (option B). Everything else is settled: if the answer is
no, #63 closes as "not viable, by Notion's design", and the pasted token is the
permanent answer rather than a temporary one.

## Re-checking this later

The constraint is Notion's, so it can change. It is worth another look if
Notion adds PKCE to `api.notion.com/v1/oauth/token`, which would show up as a
discovery document at
`https://api.notion.com/.well-known/oauth-authorization-server` listing
`code_challenge_methods_supported`, or as `token_endpoint_auth_methods_supported`
including `"none"`. One `curl` answers it.
