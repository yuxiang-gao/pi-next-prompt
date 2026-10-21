import assert from "node:assert/strict";
import { test } from "node:test";
import { readiness } from "../src/onboarding.ts";
import { parseSettings, initialSettings } from "../src/config.ts";

test("generate needs no separate model connection and disabled setup is actionable", () => {
  assert.equal(readiness(parseSettings({ enabled: true })), null);
  assert.match(readiness(initialSettings())!, /next-prompt enable/);
});

test("classifier requires configured meanings and hybrid requires authentication", () => {
  assert.match(readiness(parseSettings({ enabled: true, mode: "classifier" }))!, /classes/);
  assert.match(readiness(parseSettings({ enabled: true, mode: "hybrid" }))!, /connection/);
  assert.match(readiness({ ...initialSettings(), enabled: true, mode: "hybrid" }, {})!, /key/);
  assert.equal(readiness({ ...initialSettings(), enabled: true, mode: "hybrid" }, { TYPESAFE_API_KEY: "secret" }), null);
});
