# Fix login / email rate limit (Supabase)

If users see **Invalid login credentials** right after signup, or **Email rate limit exceeded** on forgot password, the cause is almost always Supabase auth email settings.

## What is happening

1. **Confirm email is ON** (default): signup creates the account but login fails until they click the confirmation link. Supabase often returns "Invalid login credentials" instead of a clear message.
2. **Built-in Supabase email** allows about **2 auth emails per hour** for the whole project. Signup + confirm + forgot password burns through that fast.

## Fix for testing and early users (recommended now)

In [Supabase Dashboard](https://supabase.com/dashboard/project/vyywwljyjmblofqyejvi/auth/providers) → **Authentication** → **Providers** → **Email**:

1. Turn **OFF** "Confirm email"
2. Save

New signups can sign in immediately with no email sent.

Also add your site URL under **Authentication** → **URL Configuration**:

- **Site URL:** `https://collectquiet.vercel.app`
- **Redirect URLs:** `https://collectquiet.vercel.app/**` and `http://localhost:5173/**`

## Unblock users already stuck

**Authentication** → **Users** → open the user → confirm email manually,

or run in **SQL Editor**:

```sql
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;
```

## Before real launch (production email)

Set up custom SMTP so you are not capped at 2 emails/hour:

**Authentication** → **SMTP Settings** → use [Resend](https://resend.com), Mailgun, SendGrid, etc.

Then **Authentication** → **Rate Limits** → raise "Rate limit for sending emails" (e.g. 30/hour).

You can turn confirm email back on once SMTP is configured.
