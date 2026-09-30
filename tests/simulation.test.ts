import { test } from "node:test";
import assert from "node:assert/strict";
import { concepts } from "../src/lib/catalog";
import { simulate, validateInput, getControl } from "../src/lib/simulation";
import { POST } from "../src/app/api/simulate/route";
test("legacy envelope is translated into the same deterministic v2 engine", () => {
  for (const concept of concepts) {
    const control = getControl(concept);
    for (const parameter of [control.min, control.initial, control.max]) {
      const input = {
        conceptId: concept.id,
        traffic: 1200,
        replicas: 3,
        parameter,
      };
      const result = simulate(input);
      assert.equal(result.config.version, 2);
      assert.ok(result.frames.length > 10);
      assert.deepEqual(result, simulate(input));
    }
  }
});
test("invalid configurations cannot enter the simulation", () => {
  for (const patch of [
    { traffic: Infinity },
    { traffic: -1 },
    { replicas: 1.5 },
    { parameter: NaN },
    { parameter: 121 },
    { conceptId: "missing" },
  ])
    assert.throws(() =>
      validateInput({
        conceptId: "cache-aside",
        traffic: 1000,
        replicas: 3,
        parameter: 60,
        ...patch,
      }),
    );
});
test("API rejects malformed, oversized, and unknown inputs and executes valid requests", async () => {
  const request = (body: string) =>
    new Request("http://localhost/api/simulate", { method: "POST", body });
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal((await POST(request("x".repeat(2049)))).status, 413);
  assert.equal(
    (await POST(request(JSON.stringify({ conceptId: "unknown" })))).status,
    400,
  );
  const response = await POST(
    request(
      JSON.stringify({
        conceptId: "cache-aside",
        traffic: 1200,
        replicas: 3,
        parameter: 60,
      }),
    ),
  );
  assert.equal(response.status, 200);
  assert.ok((await response.json()).frames.length > 10);
});
