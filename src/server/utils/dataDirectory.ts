import path from 'node:path';

/**
 * Single place that decides where runtime data lives.
 * Priority: test override (NODE_ENV=test only) > ALNAMARI_DATA_DIR > source-relative default.
 * The packaged Windows app sets ALNAMARI_DATA_DIR so data stays outside the install folder.
 */
export function resolveDataDirectory(
  defaultDirectory: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.NODE_ENV === 'test' && env.ALNAMARI_TEST_DATA_DIR) {
    return path.resolve(env.ALNAMARI_TEST_DATA_DIR);
  }
  const configured = env.ALNAMARI_DATA_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(defaultDirectory);
}
