Password protection for adding Bird Pokémon
-------------------------------------------

Local/dev setup (Cloudflare Pages Functions):

1) Create a `.dev.vars` file in the project root (this file is git-ignored).
2) Add this line:

```
ADD_POKEMON_PASSWORD=rookidee
```

3) Start your local dev server for Cloudflare Pages so the function under `functions/api/verify-add.js` is available.

Notes:
- The UI prompts for the password on first use and caches authorization for the session.
- The password check is performed by the Pages Function and never exposed in the client.
- If the function isn’t running, the UI will show “Password check unavailable.” and block adding.


