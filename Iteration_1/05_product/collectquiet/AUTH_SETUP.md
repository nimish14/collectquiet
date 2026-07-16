# Auth fix (do this now)

Users cannot rely on confirmation or reset emails. Supabase built-in email allows about **2 emails per hour** for the whole project, so signup confirm + forgot password both fail.

## 1. Turn off Confirm email (required)

1. Open https://supabase.com/dashboard/project/vyywwljyjmblofqyejvi/auth/providers
2. Click **Email**
3. Turn **OFF** **Confirm email**
4. Save

After this, new signups get a session immediately and can use the app.

## 2. Unblock an existing user who forgot their password

1. Open https://supabase.com/dashboard/project/vyywwljyjmblofqyejvi/auth/users
2. Open the user
3. Use **Send password recovery** only if custom SMTP is set up  
   **or** delete the user and have them sign up again after step 1  
   **or** set a new password from the user menu if your dashboard version offers it

Stuck "not confirmed" accounts can also be fixed in SQL Editor:

```sql
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;
```

## 3. Site URL

**Authentication** → **URL Configuration**

- Site URL: `https://collectquiet.vercel.app`
- Redirect URLs: `https://collectquiet.vercel.app/**`, `http://localhost:5173/**`

## 4. Before real launch: custom SMTP

Password reset and confirmation emails need real email:

**Authentication** → **SMTP Settings** (Resend, Mailgun, etc.)

Then raise email rate limits under **Authentication** → **Rate Limits**.
