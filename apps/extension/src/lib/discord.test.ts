import test from "node:test";
import assert from "node:assert/strict";
import { classifyTwoPartyAuthors } from "./discord";

test("classifyTwoPartyAuthors matches punctuation and spacing differences in Discord names", () => {
  const classification = classifyTwoPartyAuthors(
    ["John Smith", "Casey_River"],
    "casey_river",
    "john.smith",
  );

  assert.deepEqual(Array.from(classification.localAuthors), ["casey_river"]);
  assert.deepEqual(Array.from(classification.partnerAuthors), ["john smith"]);
});

test("classifyTwoPartyAuthors infers the partner in a two-author thread when only the local name matches", () => {
  const classification = classifyTwoPartyAuthors(
    ["Casey River", "Weekend Coffee"],
    "casey_river",
    "john.smith",
  );

  assert.deepEqual(Array.from(classification.localAuthors), ["casey river"]);
  assert.deepEqual(Array.from(classification.partnerAuthors), ["weekend coffee"]);
});
