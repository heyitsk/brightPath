import type { Config } from '@react-router/dev/config'

export default {
  // Server rendering on; app code lives in src/ so gen:api keeps writing to src/api/schema.d.ts.
  ssr: true,
  appDirectory: 'src',
} satisfies Config
