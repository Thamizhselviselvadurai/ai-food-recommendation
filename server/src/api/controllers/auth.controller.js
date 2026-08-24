import { z } from 'zod';
import { User } from '../../models/index.js';
import { getOrCreatePreferences } from '../../services/personalization.js';
import { signToken } from '../../middleware/auth.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  phone: z.string().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const user = new User({ name, email, phone });
  await user.setPassword(password);
  await user.save();
  await getOrCreatePreferences(user._id);

  res.status(201).json({ token: signToken(user), user: user.toPublic() });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message either way — do not reveal whether the email exists.
  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('Incorrect email or password');
  }

  user.lastActiveAt = new Date();
  await user.save();

  res.json({ token: signToken(user), user: user.toPublic() });
});

export const me = asyncHandler(async (req, res) => {
  const preferences = await getOrCreatePreferences(req.userId);
  res.json({ user: req.user.toPublic(), preferences });
});
