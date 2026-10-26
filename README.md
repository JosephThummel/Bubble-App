# Constellation

A thinking space for investors: save tweets, posts, articles and notes, and AI files each one
into a field of themed bubbles that reorganize themselves as you save.

The original single-file prototype is kept in [`prototype/constellation.jsx`](prototype/constellation.jsx).

## Run it locally

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

With only `ANTHROPIC_API_KEY` set, the app runs in **local mode**: no sign-in, and everything is
stored in your browser. Add the Supabase variables to turn on accounts and a real database.

## Set up Supabase (accounts + database)

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   It creates the `bubbles` and `items` tables with row-level security so each user only sees their own data.
3. Under **Authentication → URL Configuration**, set the Site URL to your app's URL and add
   `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` to the redirect URLs.
4. Copy the project URL and anon key from **Project Settings → API** into `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Sign-in is by emailed magic link. The first time someone signs in, anything they saved in local
mode on that browser is copied into their account.

## Deploy (Vercel)

1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. Add `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables.
3. Deploy, then add the deployed `/auth/callback` URL in Supabase (step 3 above).

## How it fits together

- `src/components/Constellation.jsx` is the bubble UI, ported from the prototype.
- `src/app/api/classify` reads a link or text and picks its theme; `src/app/api/cluster` regroups a
  theme's notes into sub-bubbles. Both run on the server so the Anthropic key never reaches the browser,
  and both require a signed-in user when Supabase is configured.
- `src/lib/storage.ts` saves the graph to Supabase (or `localStorage` in local mode).
- `src/proxy.ts` keeps the sign-in session fresh and sends signed-out visitors to `/login`.
