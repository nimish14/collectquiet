/** Map Supabase auth errors to plain messages for users. */
export function authErrorMessage(raw: string, context: 'signin' | 'signup' | 'reset'): string {
  const msg = raw.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429')) {
    if (context === 'reset') {
      return 'Too many reset attempts. Wait a few minutes and try again.';
    }
    return 'Too many attempts. Wait a minute, then try again.';
  }

  if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
    return 'This account is not active yet. Contact the person who invited you and we will unlock it.';
  }

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    if (context === 'signin') {
      return 'Wrong email or password. Double-check both, or create an account if you are new.';
    }
    return raw;
  }

  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'That email already has an account. Sign in instead.';
  }

  if (msg.includes('password should be') || msg.includes('password is known')) {
    return 'Choose a stronger password (at least 8 characters).';
  }

  return raw;
}
