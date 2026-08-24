import { Router } from 'express';

import * as auth from './controllers/auth.controller.js';
import * as ai from './controllers/ai.controller.js';
import * as crowd from './controllers/crowd.controller.js';
import * as food from './controllers/food.controller.js';
import * as feedback from './controllers/feedback.controller.js';
import * as meta from './controllers/meta.controller.js';
import * as order from './controllers/order.controller.js';
import * as recommendation from './controllers/recommendation.controller.js';
import * as restaurant from './controllers/restaurant.controller.js';
import * as user from './controllers/user.controller.js';

import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { aiLimiter, authLimiter, crowdWriteLimiter } from '../middleware/rateLimit.js';
import { requireObjectId, validate } from '../middleware/validate.js';

export const router = Router();

// ── Meta ────────────────────────────────────────────────────────────────────
router.get('/health', meta.health);
router.get('/context', meta.context);
router.get('/crowd/methodology', crowd.methodology);

// ── Auth ────────────────────────────────────────────────────────────────────
router.post('/auth/register', authLimiter, validate(auth.registerSchema), auth.register);
router.post('/auth/login', authLimiter, validate(auth.loginSchema), auth.login);
router.get('/auth/me', requireAuth, auth.me);

// ── Discovery ───────────────────────────────────────────────────────────────
router.get('/restaurants', optionalAuth, restaurant.list);
router.get('/restaurants/nearby', optionalAuth, validate(restaurant.nearbySchema, 'query'), restaurant.nearby);
// Live places provider: status + server-side photo proxy (keeps the API key private)
router.get('/places/status', restaurant.placesStatus);
router.get('/places/photo', restaurant.placePhoto);
router.get('/restaurants/:id', optionalAuth, requireObjectId(), restaurant.detail);
router.get('/restaurants/:id/crowd/outlook', requireObjectId(), restaurant.crowdOutlook);

router.get('/foods', optionalAuth, food.search);
router.get('/foods/:id', optionalAuth, requireObjectId(), food.detail);

// ── Recommendations (guests welcome; personalised when signed in) ────────────
router.get('/recommendations/weights', recommendation.weightsHandler);
router.post(
  '/recommendations/foods',
  optionalAuth,
  validate(recommendation.preferenceInputSchema),
  recommendation.recommendFoodsHandler
);
router.post(
  '/recommendations/places',
  optionalAuth,
  validate(recommendation.preferenceInputSchema),
  recommendation.recommendPlacesHandler
);
router.post(
  '/recommendations/alternatives',
  optionalAuth,
  validate(recommendation.preferenceInputSchema),
  recommendation.alternativesHandler
);
router.post(
  '/recommendations/smart',
  optionalAuth,
  aiLimiter,
  validate(recommendation.smartRequestSchema),
  recommendation.smartDecisionHandler
);
router.get('/recommendations/history', requireAuth, recommendation.historyHandler);

// ── AI assistant ────────────────────────────────────────────────────────────
router.get('/ai/status', ai.status);
router.post('/ai/chat', optionalAuth, aiLimiter, validate(ai.chatSchema), ai.chat);
router.post('/ai/parse', optionalAuth, aiLimiter, validate(ai.parseSchema), ai.parse);

// ── Crowd intelligence ──────────────────────────────────────────────────────
router.get('/restaurants/:id/crowd', requireObjectId(), crowd.status);
router.post(
  '/restaurants/:id/checkin',
  optionalAuth,
  crowdWriteLimiter,
  requireObjectId(),
  validate(crowd.checkInSchema),
  crowd.checkIn
);
router.post(
  '/restaurants/:id/crowd-report',
  optionalAuth,
  crowdWriteLimiter,
  requireObjectId(),
  validate(crowd.reportSchema),
  crowd.report
);

// ── Account ─────────────────────────────────────────────────────────────────
router.get('/me/dashboard', optionalAuth, user.dashboard);
router.get('/me/preferences', requireAuth, user.getPreferences);
router.put('/me/preferences', requireAuth, validate(user.preferencesSchema), user.updatePreferences);
router.post('/me/preferences/reset-learning', requireAuth, user.resetLearning);
router.get('/me/favorites', requireAuth, user.listFavorites);
router.post('/me/favorites', requireAuth, validate(user.favoriteSchema), user.toggleFavorite);
router.post('/me/ratings', requireAuth, validate(user.ratingSchema), user.rate);
router.post('/me/addresses', requireAuth, validate(user.addressSchema), user.addAddress);
router.delete('/me/addresses/:addressId', requireAuth, user.deleteAddress);

// ── Orders ──────────────────────────────────────────────────────────────────
router.post('/orders', requireAuth, validate(order.createOrderSchema), order.create);
router.get('/orders', requireAuth, order.list);
router.get('/orders/:id', requireAuth, requireObjectId(), order.detail);
router.post('/orders/:id/cancel', requireAuth, requireObjectId(), order.cancel);

// ── Feedback / learning ─────────────────────────────────────────────────────
router.post('/feedback', requireAuth, validate(feedback.feedbackSchema), feedback.submit);
router.get('/feedback', requireAuth, feedback.history);
