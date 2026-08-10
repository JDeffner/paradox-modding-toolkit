/** Array helpers shared by the server and the client. */

/**
 * Append every element of `source` to `target`.
 *
 * `target.push(...source)` passes one argument per element and throws
 * `RangeError: Maximum call stack size exceeded` past ~125k elements (measured,
 * node 24, default stack). On the index paths that is a size-triggered crash:
 * one engine/vanilla root already carries ~460k definitions and one generated
 * mod file can carry six figures on its own. The loop has no ceiling and
 * measures the same as the spread (2M elements appended in 10k pieces: 23 ms
 * loop vs 22 ms spread; as one 500k piece: 5.5 ms loop vs 9.6 ms spread).
 */
export function pushAll<T>(target: T[], source: readonly T[]): void {
  for (let i = 0; i < source.length; i++) target.push(source[i]);
}
