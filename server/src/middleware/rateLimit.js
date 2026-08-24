import rateLimit from 'express-rate-limit';

const message = (text) => ({ error: { message: text, status: 429 } });

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many requests. Please slow down.'),
});

/** AI routes cost real money — keep them tighter than the rest of the API. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip,
  message: message('You are asking the assistant a lot. Give it a minute.'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many sign-in attempts. Try again in a few minutes.'),
});

/** One person should not be able to fake a crowd with 50 check-ins. */
export const crowdWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip,
  message: message('You have submitted several reports recently. Thanks — try again later.'),
});
