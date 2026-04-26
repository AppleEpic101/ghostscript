import test from "node:test";
import assert from "node:assert/strict";
import {
  compressPlaintextWithRealModelRanks,
  tracePlaintextWithRealModelRanks,
} from "./realModelPlaintextRankCompression";

test("real tokenizer and model-backed ranks produce a trace for a natural message", { timeout: 300_000 }, async () => {
  const result = await tracePlaintextWithRealModelRanks("I want to eat pizza.");

  console.log('REAL_TRACE plaintext="I want to eat pizza."');
  for (const step of result.trace) {
    console.log(
      [
        `index=${step.index}`,
        `token=${JSON.stringify(step.tokenText)}`,
        `tokenId=${step.tokenId}`,
        `rank=${step.rank}`,
        `mode=${step.mode}`,
        `fallback=${step.usedLiteralFallback}`,
        `bits=${step.encodedBits}`,
      ].join(" | "),
    );
  }
  console.log(`REAL_TRACE fullBitstring=${result.bitstring}`);

  assert.ok(result.trace.length > 0);
});

test("real tokenizer/model rank compression reports reduction ratios", { timeout: 300_000 }, async () => {
  const samples = [
    "I want to eat pizza.",
    "Meet near the side entrance after dinner so we can talk without the line getting weird.",
    "Can you send the address before I leave?",
  ];

  let totalCompressed = 0;
  let totalFixedWidth = 0;
  let totalUtf8 = 0;

  for (const plaintext of samples) {
    const result = await compressPlaintextWithRealModelRanks(plaintext);
    totalCompressed += result.stats.compressedBitLength;
    totalFixedWidth += result.stats.fixedWidthBitLength;
    totalUtf8 += result.stats.utf8BitLength;

    console.log(
      [
        `REAL_RATIO plaintext=${JSON.stringify(plaintext)}`,
        `tokens=${result.stats.tokenCount}`,
        `compressed=${result.stats.compressedBitLength}b`,
        `fixedWidth=${result.stats.fixedWidthBitLength}b`,
        `utf8=${result.stats.utf8BitLength}b`,
        `vsFixed=${result.stats.compressedToFixedWidthRatio.toFixed(3)}`,
        `vsUtf8=${result.stats.compressedToUtf8Ratio.toFixed(3)}`,
        `short=${result.stats.shortRankCount}`,
        `medium=${result.stats.mediumRankCount}`,
        `literal=${result.stats.literalCount}`,
      ].join(" | "),
    );
  }

  console.log(
    [
      "REAL_RATIO aggregate",
      `compressed=${totalCompressed}b`,
      `fixedWidth=${totalFixedWidth}b`,
      `utf8=${totalUtf8}b`,
      `vsFixed=${(totalCompressed / totalFixedWidth).toFixed(3)}`,
      `vsUtf8=${(totalCompressed / totalUtf8).toFixed(3)}`,
    ].join(" | "),
  );

  assert.ok(totalCompressed > 0);
});
