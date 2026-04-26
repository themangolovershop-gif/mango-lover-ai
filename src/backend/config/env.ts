import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env.local if it exists, otherwise .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const positiveInteger = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const nonNegativeInteger = (defaultValue: number) =>
  z.coerce.number().int().min(0).default(defaultValue);

const envSchema = z
  .object({
    PORT: z.string().default('3001').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().url().optional().or(z.string().length(0)).default(''),
    OPENAI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('openai/gpt-4o-mini'),
    AI_REQUEST_TIMEOUT_MS: positiveInteger(15_000),
    AI_MAX_RETRIES: positiveInteger(3),
    AI_RETRY_BASE_DELAY_MS: nonNegativeInteger(500),
    WHATSAPP_PROVIDER: z.enum(['twilio', 'meta']).default('meta'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_WHATSAPP_NUMBER: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_REQUEST_TIMEOUT_MS: positiveInteger(10_000),
    WHATSAPP_MAX_RETRIES: positiveInteger(2),
    WHATSAPP_RETRY_BASE_DELAY_MS: nonNegativeInteger(1_000),
    APP_BASE_URL: z.string().url().default('http://localhost:3001'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((value, context) => {
    if (value.WHATSAPP_PROVIDER === 'meta') {
      if (!value.WHATSAPP_ACCESS_TOKEN) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_ACCESS_TOKEN'],
          message: 'WHATSAPP_ACCESS_TOKEN is required when WHATSAPP_PROVIDER=meta.',
        });
      }

      if (!value.WHATSAPP_PHONE_NUMBER_ID) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_PHONE_NUMBER_ID'],
          message: 'WHATSAPP_PHONE_NUMBER_ID is required when WHATSAPP_PROVIDER=meta.',
        });
      }

      if (!value.WHATSAPP_APP_SECRET) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_APP_SECRET'],
          message: 'WHATSAPP_APP_SECRET is required when WHATSAPP_PROVIDER=meta.',
        });
      }

      return;
    }

    if (!value.TWILIO_ACCOUNT_SID) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'TWILIO_ACCOUNT_SID is required when WHATSAPP_PROVIDER=twilio.',
      });
    }

    if (!value.TWILIO_AUTH_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_AUTH_TOKEN'],
        message: 'TWILIO_AUTH_TOKEN is required when WHATSAPP_PROVIDER=twilio.',
      });
    }

    if (!value.TWILIO_WHATSAPP_NUMBER) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_WHATSAPP_NUMBER'],
        message: 'TWILIO_WHATSAPP_NUMBER is required when WHATSAPP_PROVIDER=twilio.',
      });
    }
  });

const isBuildStep = process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;

const _env = isBuildStep 
  ? envSchema.safeParse(process.env) // Still parse to get defaults
  : envSchema.safeParse(process.env);

if (!_env.success && !isBuildStep) {
  console.error(
    'Invalid environment variables:',
    JSON.stringify(_env.error.format(), null, 2)
  );
  process.exit(1);
}

export const env = _env.data || ({} as any);
