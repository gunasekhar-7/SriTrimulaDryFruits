import express from 'express';
import { observabilityController } from '../controllers/observability.controller.js';

export const observabilityRouter = express.Router();

observabilityRouter.get('/summary', observabilityController.getMetricsSummary.bind(observabilityController));
observabilityRouter.get('/traces', observabilityController.getTraces.bind(observabilityController));
observabilityRouter.get('/traces/:traceId', observabilityController.getTraceById.bind(observabilityController));
