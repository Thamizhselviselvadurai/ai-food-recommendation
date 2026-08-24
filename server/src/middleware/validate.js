import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

/** Validates `req[source]` against a zod schema and replaces it with the parsed value. */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const parsed = schema.safeParse(req[source]);
  if (!parsed.success) {
    const details = Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join('.') || '_', issue.message])
    );
    return next(ApiError.badRequest('Please check the highlighted fields', details));
  }
  req[source] = parsed.data;
  next();
};

export const requireObjectId = (param = 'id') => (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params[param])) {
    return next(ApiError.badRequest(`"${req.params[param]}" is not a valid id`));
  }
  next();
};
