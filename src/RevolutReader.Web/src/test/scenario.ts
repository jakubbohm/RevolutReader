import { test } from "vitest";

/**
 * Claims an OpenSpec scenario for the test it registers (docs/conventions/testing.md § Every scenario has exactly one
 * test, c003 design.md D7). The test is named `<capability> / <name>`. Write the capability and the name as string
 * literals, exactly as in the spec: the traceability check reads them from the source and reports any other call.
 */
export function scenario(
  capability: string,
  name: string,
  body: () => void | Promise<void>,
): void {
  test(`${capability} / ${name}`, body);
}
