/**
 * The CSP nonce every webview page declares.
 *
 * A nonce is a barrier to injected script only while it is unpredictable, and
 * `Math.random()` is not a CSPRNG: V8's state is recoverable from observed
 * output. Five hand-rolled copies of this used it. 24 random bytes is 32
 * base64url characters, the same length those copies produced.
 */
import { randomBytes } from "crypto";

export function makeNonce(): string {
  return randomBytes(24).toString("base64url");
}
