import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export function notFound(req, res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(error, req, res, next) {
  let status = 500;
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (error instanceof ApiError) {
    status = error.status;
    message = error.message;
    details = error.details;
  } else if (error instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Some fields are invalid';
    details = Object.fromEntries(Object.entries(error.errors).map(([key, e]) => [key, e.message]));
  } else if (error instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid value for "${error.path}"`;
  } else if (error?.code === 11000) {
    status = 409;
    message = `That ${Object.keys(error.keyPattern ?? {}).join(', ') || 'record'} is already taken`;
  } else if (error?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body is not valid JSON';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  }

  res.status(status).json({
    error: {
      message,
      status,
      ...(details ? { details } : {}),
      ...(env.NODE_ENV === 'development' && status >= 500 ? { stack: error.stack } : {}),
    },
  });
}
