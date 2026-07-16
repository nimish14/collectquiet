/** Map Supabase auth errors to plain messages for users. */
export function authErrorMessage(raw: string, context: 'signin' | 'signup' | 'reset'): string {
  const msg = raw.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429')) {
    if (context === 'reset') {
      return 'Password reset email could not be sent. Email delivery is limited on this app right now.';
    }
    return 'Too many signup emails sent. Wait a bit, then try again with a different email if needed.';
  }

  if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
    return 'This account is not active yet. Ask the site owner to confirm your email in Supabase, then try again.';
  }

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    if (context === 'signin') {
      return 'Wrong email or password. Password reset by email is not working yet, so use the password you signed up with.';
    }
    return raw;
  }

  if (msg.includes('user already registered')) {
    return 'That email is already registered. Try signing in with the password you used at signup.';
  }

  return raw;
}
