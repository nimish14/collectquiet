/** Map Supabase auth errors to plain messages for users. */
export function authErrorMessage(raw: string, context: 'signin' | 'signup' | 'reset'): string {
  const msg = raw.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429')) {
    if (context === 'reset') {
      return 'Too many emails sent from this app right now. Wait about an hour, or ask the site owner to turn off email confirmation in Supabase.';
    }
    return 'Too many signup or reset emails sent. Wait about an hour before trying again.';
  }

  if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
    return 'Confirm your email first. Check inbox and spam for the link from Supabase.';
  }

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    if (context === 'signin') {
      return 'Wrong email or password. If you just signed up, you may need to confirm your email before signing in.';
    }
    return raw;
  }

  if (msg.includes('user already registered')) {
    return 'That email is already registered. Try signing in instead.';
  }

  return raw;
}
