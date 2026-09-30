import { test } from "node:test";
import assert from "node:assert/strict";
import { handler, validateProgress } from "../infra/handler.mjs";
import { concepts } from "../src/lib/catalog";
import { getControl } from "../src/lib/simulation";
test("cloud validation matches every supported lesson and refuses invalid records", () => {
  for (const concept of concepts)
    assert.ok(
      validateProgress({
        conceptId: concept.id,
        traffic: 1200,
        replicas: 3,
        parameter: getControl(concept).initial,
      }),
    );
  for (const input of [
    null,
    {},
    { conceptId: "__proto__" },
    { conceptId: "cache-aside", traffic: 1200, replicas: 3, parameter: 9000 },
  ])
    assert.equal(validateProgress(input), false);
});
test("cloud identity comes only from verified JWT context; no storage calls for invalid input", async () => {
  const response = await handler({
    body: JSON.stringify({ sub: "attacker-controlled" }),
    requestContext: { http: { method: "POST" } },
  });
  assert.equal(response.statusCode, 401);
  const event = {
    requestContext: {
      http: { method: "POST" },
      authorizer: {
        jwt: { claims: { sub: "00000000-0000-0000-0000-000000000000" } },
      },
    },
    body: "{invalid",
  };
  assert.equal((await handler(event)).statusCode, 400);
  assert.equal(
    (await handler({ ...event, body: "x".repeat(2049) })).statusCode,
    413,
  );
});
