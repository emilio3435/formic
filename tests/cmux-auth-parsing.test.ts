import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cmuxSocketPassword,
  loadCmuxSocketEnv,
  resetCmuxAuthForTests,
} from "../src/server/cmux-auth";

/* How data/cmux-socket.env is read.

   cmux-auth.test.ts covers argv hygiene, load precedence and the CMUX_*
   identity variables, but nothing reaches parseEnvFile's own decisions.
   Mutation testing found three of them unenforced: honouring a commented-out
   line, keeping the surrounding quotes, and returning an empty string for a
   bare assignment all killed nothing.

   Each has the same operator-facing consequence and it is a bad one. The socket
   password is what lets the hub drive cmux from outside it, so a password read
   WRONG does not fail loudly — it authenticates wrongly, focus and instruct
   stop routing, and the board reports a degraded control plane whose stated
   cause is a socket error rather than "your quotes are part of your password".
   That is the confusing degraded state this cockpit exists to explain, produced
   by its own config reader.

   Every case asserts the parsed value, not merely that something was read. */

const originalPassword = process.env.CMUX_SOCKET_PASSWORD;
const roots: string[] = [];

afterEach(() => {
  resetCmuxAuthForTests();
  if (originalPassword === undefined) delete process.env.CMUX_SOCKET_PASSWORD;
  else process.env.CMUX_SOCKET_PASSWORD = originalPassword;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Writes an env file and returns what cmuxSocketPassword() makes of it. */
function passwordFrom(contents: string): string | undefined {
  const root = mkdtempSync(join(tmpdir(), "anthill-cmux-parse-"));
  roots.push(root);
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "data/cmux-socket.env"), contents);

  delete process.env.CMUX_SOCKET_PASSWORD;
  resetCmuxAuthForTests();
  loadCmuxSocketEnv(root);
  return cmuxSocketPassword();
}

describe("the socket password is read exactly as written", () => {
  test("a bare assignment is read verbatim", () => {
    // The control: without it every assertion below could pass on a reader
    // that never returns anything.
    expect(passwordFrom("CMUX_SOCKET_PASSWORD=hunter2\n")).toBe("hunter2");
  });

  test("an export prefix is accepted, since the file is written to be sourced", () => {
    expect(passwordFrom("export CMUX_SOCKET_PASSWORD=hunter2\n")).toBe("hunter2");
  });

  test("surrounding quotes are stripped rather than becoming part of the secret", () => {
    /* setup:cmux writes the file; an operator editing it by hand reasonably
       quotes the value. Keeping the quotes yields a password that is wrong by
       exactly two characters — long enough to look right in the file and
       guaranteed to fail against the socket. */
    expect(passwordFrom('CMUX_SOCKET_PASSWORD="hunter2"\n')).toBe("hunter2");
    expect(passwordFrom("CMUX_SOCKET_PASSWORD='hunter2'\n")).toBe("hunter2");
  });

  test("a commented-out password is not honoured", () => {
    /* Commenting the line out is how an operator disables it. Reading it anyway
       means the disable silently did nothing, which is worse than either
       outcome they were choosing between. */
    expect(passwordFrom("# CMUX_SOCKET_PASSWORD=disabled\n")).toBeUndefined();
    expect(passwordFrom("#CMUX_SOCKET_PASSWORD=disabled\n")).toBeUndefined();
  });

  test("a commented line does not shadow a real one below it", () => {
    // The two rules have to compose: skipping comments must not stop the parse.
    expect(passwordFrom("# CMUX_SOCKET_PASSWORD=old\nCMUX_SOCKET_PASSWORD=current\n")).toBe("current");
  });

  test("an empty assignment reads as no password, not as an empty one", () => {
    /* "" and undefined route differently downstream: cmuxCommand omits the
       flag entirely when there is no password, and an empty string would be
       passed as a real, wrong credential. */
    expect(passwordFrom("CMUX_SOCKET_PASSWORD=\n")).toBeUndefined();
    expect(passwordFrom('CMUX_SOCKET_PASSWORD=""\n')).toBeUndefined();
    expect(passwordFrom("CMUX_SOCKET_PASSWORD=   \n")).toBeUndefined();
  });

  test("an empty assignment does not consume the real one below it", () => {
    /* The case that makes the rule above testable at all. Read through the
       public API, an empty value and no value are indistinguishable — the
       loader ignores a falsy result either way — so the three assertions above
       hold even if the parser stops skipping empties.

       Two lines separate them. Skipping the empty means the parser keeps
       looking and finds the real password; returning it means the file is
       abandoned at the first match and the hub comes up with no credential at
       all, with the working password sitting one line below. */
    expect(passwordFrom("CMUX_SOCKET_PASSWORD=\nCMUX_SOCKET_PASSWORD=real\n")).toBe("real");
    expect(passwordFrom('CMUX_SOCKET_PASSWORD=""\nexport CMUX_SOCKET_PASSWORD=real\n')).toBe("real");
  });

  test("an unrelated file yields no password rather than a guess", () => {
    expect(passwordFrom("SOME_OTHER_KEY=value\n# nothing here\n")).toBeUndefined();
  });
});
