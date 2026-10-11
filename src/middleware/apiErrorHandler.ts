import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/apiResponse.js';
import logger from '../logger.js';
import { z } from 'zod';

export function apiErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  logger.error(`API Error on ${req.method} ${req.url}:`, err);

  if (err instanceof z.ZodError) {
    return sendError(res, 'VALIDATION_ERROR', err.issues.map(i => i.message).join(', '));
  }

  if (err.message && (err.message.includes('Insufficient stock') || err.message.includes('No valid items in cart') || err.message.toLowerCase().includes('out of stock'))) {
    return sendError(res, 'OUT_OF_STOCK', err.message, 409);
  }
  
  if (err.message === 'Concurrent request in progress') {
    return sendError(res, 'CONCURRENT_REQUEST', err.message, 409);
  }

  if (err.status && typeof err.status === 'number') {
    return sendError(res, 'REQUEST_ERROR', err.message, err.status);
  }

  // Generic fallback
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : err.message || 'Internal Server Error';
    
  sendError(res, 'INTERNAL_SERVER_ERROR', message, 500);
}
