import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env.local if it exists, otherwise .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z
  .object({
    PORT: z.string().default('3001').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().url(),
    OPENAI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('openai/gpt-4o-mini'),
    WHATSAPP_PROVIDER: z.enum(['twilio', 'meta']).default('twilio'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_WHATSAPP_NUMBER: z.string().optional(),
    APP_BASE_URL: z.string().url().default('http://localhost:3001'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((value, context) => {
    if (value.WHATSAPP_PROVIDER !== 'twilio') {
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

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error(
    'Invalid environment variables:',
    JSON.stringify(_env.error.format(), null, 2)
  );
  process.exit(1);
}

export const env = _env.data;
