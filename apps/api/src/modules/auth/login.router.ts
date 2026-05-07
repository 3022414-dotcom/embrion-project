import type { FastifyPluginAsync } from 'fastify';
import type postgres from 'postgres';
import { login } from './login.service.js';

type LoginRouterOptions = { sql: postgres.Sql };

export const loginRouter: FastifyPluginAsync<LoginRouterOptions> = async (app, opts) => {
  app.post('/api/v1/auth/login', {
    config: { skipAuth: true },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;

    if (
      !body ||
      typeof body['email'] !== 'string' ||
      body['email'].trim() === '' ||
      typeof body['password'] !== 'string' ||
      body['password'].trim() === ''
    ) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const result = await login(opts.sql, {
      email: body['email'],
      password: body['password'],
      sign: (payload, options) => app.jwt.sign(payload, options),
    });

    if (result.status === 'ok') {
      return reply.status(200).send({ token: result.token });
    }
    if (result.status === 'rate_limited') {
      return reply.status(429).send({
        error: 'Too many attempts',
        retry_after_seconds: result.retryAfterSeconds,
      });
    }
    // status === 'invalid' or 'inactive' — same body, no leakage
    return reply.status(401).send({ error: 'Invalid credentials' });
  });
};
