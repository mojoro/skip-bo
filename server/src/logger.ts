import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  base: undefined,
  messageKey: 'msg',
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export type Logger = typeof logger;
