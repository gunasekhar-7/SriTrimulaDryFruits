import { Response } from 'express';

export function sendSuccess(res: Response, data: any = {}, statusCode: number = 200) {
  res.status(statusCode).json({
    success: true,
    data,
    error: null,
    requestId: res.locals.requestId || crypto.randomUUID()
  });
}

export function sendError(res: Response, code: string, message: string, statusCode: number = 400) {
  res.status(statusCode).json({
    success: false,
    data: null,
    error: {
      code,
      message
    },
    requestId: res.locals.requestId || crypto.randomUUID()
  });
}
