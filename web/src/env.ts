import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    SERVER_URL: z.string().url().optional(),
  },

  clientPrefix: 'VITE_',

  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
    VITE_API_URL: z.string().url().optional(),
    VITE_WALLETCONNECT_PROJECT_ID: z.string().min(1).optional(),
    VITE_CHAIN_ID: z.coerce.number().optional(),
  },

  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
})
