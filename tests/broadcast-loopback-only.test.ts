import { describe, expect, test } from "bun:test";
import { handleBroadcastRequest } from "../src/server/broadcast";
import type { BroadcastDependencies } from "../src/server/broadcast";

/* The loopback arm of the broadcast origin guard, which nothing exercised.

   Found by the disjunction sweep. The guard is

     !isLoopback(url.hostname) || !origin || origin !== url.origin

   and every fixture in broadcast, broadcast-rotation, control-http,
   operator-endpoints, static-serving, static-root-containment and
   publish-state reached it through the ORIGIN arms. Dropping the loopback
   check entirely leaves all 91 of those green.

   WHY THIS ARM AND NOT ANOTHER. Broadcast is the widest-reach endpoint in the
   product: one request instructs up to fifty agents. The origin arms stop a
   cross-site caller; the loopback arm is what stops the board answering to a
   non-local host at all. Without it, a request whose Origin matches its own URL
   is accepted from anywhere — and an attacker composing the request controls
   both sides of that comparison, so same-origin is trivially satisfiable and
   the only real barrier is the hostname.

   A NOTE ON THE SIBLING ARM, checked and deliberately not tested. Dropping
   `!origin` is an EQUIVALENT MUTANT: a missing header is null, and
   `null !== url.origin` already refuses. Removing it changes no outcome, so a
   test pinning it would assert against the language rather than the product.

   These drive handleBroadcastRequest directly rather than through a live
   server, so they exercise the guard as written and depend on nothing running. */

const runner = { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) };
/* An empty fleet: the request is entitled to fail LATER for having no such
   agent, which is why the control below asserts "not ORIGIN_REJECTED" rather
   than "accepted". Getting past the origin gate is the whole claim. */
const dependencies = {
  runner,
  cmuxExecutable: "cmux",
  archiveStore: { has: () => false, archive: async () => {} },
  getSnapshot: () => ({ schemaVersion: 1, programs: [], totals: {} } as never),
} as unknown as BroadcastDependencies;

const body = JSON.stringify({ agentIds: ["codex:alpha"], instruction: "stand down" });

function request(hostname: string, origin?: string): Request {
  const url = `http://${hostname}:4701/api/broadcast`;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
    },
    body,
  });
}

const send = (hostname: string, origin?: string) => handleBroadcastRequest(request(hostname, origin), dependencies);

describe("broadcast answers only to the machine it runs on", () => {
  test.each(["127.0.0.1", "localhost", "[::1]"])("a same-origin request from %s is not rejected on origin", async (host) => {
    /* The control, and it has to come first: every refusal below would also
       hold on a build that refused everything, which is the failure mode a
       security test most easily hides behind.

       Asserted as "not ORIGIN_REJECTED" rather than "accepted", because these
       fixtures carry no real agents and the request is entitled to fail later
       for that reason. What matters is that it got past the origin gate. */
    const response = await send(host, `http://${host}:4701`);
    const payload = await response.json() as { error?: { code?: string } };

    expect(payload.error?.code ?? "").not.toBe("ORIGIN_REJECTED");
  });

  test.each(["10.0.0.5", "example.com", "0.0.0.0", "192.168.1.20"])(
    "a same-origin request from %s is refused because the host is not loopback",
    async (host) => {
      /* THE ARM THAT WAS DEAD. Origin matches the URL exactly, so both origin
         arms are satisfied and only the loopback check can produce this
         refusal. An attacker composing the request controls the Origin header
         and the URL alike, which is precisely why same-origin cannot be the
         only barrier on an endpoint that instructs fifty agents. */
      const response = await send(host, `http://${host}:4701`);
      const payload = await response.json() as { error?: { code?: string } };

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("ORIGIN_REJECTED");
    },
  );

  test("the refusal is identical whether the host or the origin is wrong", async () => {
    /* Deliberate: the two arms must not be distinguishable from outside. A
         response that said "bad host" versus "bad origin" would tell a caller
       which barrier it had cleared, which is a probe oracle on the endpoint
       with the widest blast radius in the product. */
    const badHost = await send("10.0.0.5", "http://10.0.0.5:4701");
    const badOrigin = await send("127.0.0.1", "http://evil.example");

    expect(badHost.status).toBe(badOrigin.status);
    expect((await badHost.json() as { error?: { code?: string } }).error?.code)
      .toBe((await badOrigin.json() as { error?: { code?: string } }).error?.code);
  });

  test("nothing reaches the runner when the host is rejected", async () => {
    /* The half that matters. A refusal issued after the instruction had already
       gone would have broadcast to fifty agents and then reported that it had
       not. */
    const commands: string[][] = [];
    const recording = {
      ...dependencies,
      runner: { run: async (command: readonly string[]) => { commands.push([...command]); return { exitCode: 0, stdout: "", stderr: "", timedOut: false }; } },
    } as unknown as BroadcastDependencies;

    await handleBroadcastRequest(request("10.0.0.5", "http://10.0.0.5:4701"), recording);

    expect(commands).toEqual([]);
  });
});
