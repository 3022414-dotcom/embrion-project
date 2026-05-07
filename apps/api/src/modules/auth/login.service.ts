import type postgres from 'postgres';
import bcrypt from 'bcryptjs';
import * as userRepository from './user.repository.js';
import * as loginAttemptRepository from './login-attempt.repository.js';

export type SignFn = (payload: Record<string, unknown>, options?: { expiresIn: string }) => string;

export type LoginResult =
  | { status: 'ok'; token: string }
  | { status: 'invalid' }
  | { status: 'inactive' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MINUTES = 15;

export async function login(
  sql: postgres.Sql,
  opts: { email: string; password: string; sign: SignFn },
): Promise<LoginResult> {
  // Step 1: normalise email
  const email = opts.email.toLowerCase();

  // Step 2: check rate limit before any DB user lookup
  const recentFailures = await loginAttemptRepository.countRecent(sql, email, RATE_LIMIT_WINDOW_MINUTES);
  if (recentFailures >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = RATE_LIMIT_WINDOW_MINUTES * 60 - recentFailures;
    return { status: 'rate_limited', retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  // Step 3: look up user by email
  const user = await userRepository.findByEmail(sql, email);
  if (!user) {
    await loginAttemptRepository.record(sql, email);
    return { status: 'invalid' };
  }

  // Step 4: check is_active
  if (!user.isActive) {
    return { status: 'inactive' };
  }

  // Step 5: verify password
  const passwordOk = await bcrypt.compare(opts.password, user.passwordHash);
  if (!passwordOk) {
    await loginAttemptRepository.record(sql, email);
    return { status: 'invalid' };
  }

  // Step 6: clear failed-attempt counter
  await loginAttemptRepository.clearByEmail(sql, email);

  // Step 7: build JWT payload
  const payload: Record<string, unknown> = {
    sub: user.id,
    role: user.role,
  };
  if (user.clinicId !== null) {
    payload['clinic_id'] = user.clinicId;
  }

  // Step 8: sign and return token
  const token = opts.sign(payload, { expiresIn: '8h' });
  return { status: 'ok', token };
}
