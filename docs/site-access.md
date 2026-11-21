# Private website access

Every page, asset and API request passes through the root Next.js proxy. Unauthenticated pages redirect to a standalone German password form; API requests return 401. Existing server access keys remain required for their protected operations after website login.

The chosen local password is configured in the ignored `.env.local`, using a salted scrypt hash (`AFFENTRADER_SITE_PASSWORD_HASH`, formatted as 32 hex salt characters, a colon and 128 hex hash characters). `AFFENTRADER_SITE_SESSION_SECRET` is an independent random secret of at least 64 hex characters. Neither is a `NEXT_PUBLIC_` variable. Missing configuration fails closed with 503.

For hosting, configure these two environment variables in the server's private environment. Do not publish `.env.local` or `.data`. HTTPS sessions use a persistent `Secure`, `HttpOnly`, `SameSite=Lax` cookie. A top-level link from another site can open the workspace with the current session. The signed session expires seven days after login. Rotating either server variable invalidates existing sessions. A same-origin POST to `/logout` clears the browser cookie. A shared password grants the same website access to everyone who knows it.

The server process limits login attempts to 30 per minute globally without trusting forwarded IP headers. Multiple server instances need an additional shared or reverse-proxy rate limit. The service worker forwards workspace and login navigations to the server. If the network request fails, it shows a static offline notice with a retry link. It stores no page, asset or API responses and removes old offline caches on activation. Existing already-open pages and previously downloaded data cannot be remotely erased by adding a login screen.

Verification covers password failures, successful login, cookie flags and lifetime, expired/tampered/password-rotated sessions, external navigation, API/static/RSC protection, cross-origin write rejection, bounded bodies and safe local redirects.
