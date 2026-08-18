/** Poll render keys until every diagram has a cached success/error result. */
export async function waitForRenderKeys(
  keys: readonly string[],
  isReady: (key: string) => boolean,
  sleep: () => Promise<void>,
  timeoutMs = 8_000,
  now: () => number = Date.now,
): Promise<boolean> {
  const deadline = now() + timeoutMs
  while (keys.some((key) => !isReady(key)) && now() < deadline) await sleep()
  return keys.every(isReady)
}
