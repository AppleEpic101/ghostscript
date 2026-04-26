import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePlaintextRankCompression,
  compressPlaintextToLayeredRankBitstring,
  compressPlaintextToRankBitstring,
  decompressPlaintextFromLayeredRankBitstring,
  decompressPlaintextFromRankBitstring,
} from "./plaintextRankCompression";

const SAMPLE_MESSAGES = [
  "i think that sounds pretty good.",
  "we can keep the message short and casual.",
  "the coffee place near the station is still open.",
  "maybe we can circle back after dinner.",
  "i can send a quick update in a minute.",
];

test("plaintext rank compression roundtrips representative messages", () => {
  for (const plaintext of SAMPLE_MESSAGES) {
    const compressed = compressPlaintextToRankBitstring(plaintext);
    const decompressed = decompressPlaintextFromRankBitstring(compressed.bitstring);

    assert.equal(decompressed, plaintext);
  }
});

test("plaintext rank compression preserves exact bytes for unusual input via literal fallback", () => {
  const plaintext = "Meet me at 7:45? Bring ID: ZX-81.\nThanks!";
  const compressed = compressPlaintextToRankBitstring(plaintext);
  const decompressed = decompressPlaintextFromRankBitstring(compressed.bitstring);

  assert.equal(decompressed, plaintext);
  assert.ok(compressed.stats.literalCount > 0);
});

test("traditional bit compression layers cleanly on top of rank compression", () => {
  for (const plaintext of SAMPLE_MESSAGES) {
    const compressed = compressPlaintextToLayeredRankBitstring(plaintext);
    const decompressed = decompressPlaintextFromLayeredRankBitstring(compressed.traditionalCompression.base64);

    assert.equal(decompressed, plaintext);
  }
});

test("plaintext rank compression reports aggregate bit reduction ratios", () => {
  const aggregate = {
    compressedBitLength: 0,
    layeredBitLength: 0,
    fixedWidthBitLength: 0,
    utf8BitLength: 0,
    tokenCount: 0,
    shortRankCount: 0,
    mediumRankCount: 0,
    literalCount: 0,
  };

  for (const plaintext of SAMPLE_MESSAGES) {
    const stats = analyzePlaintextRankCompression(plaintext);
    const layered = compressPlaintextToLayeredRankBitstring(plaintext);
    aggregate.compressedBitLength += stats.compressedBitLength;
    aggregate.layeredBitLength += layered.traditionalCompression.framedBitLength;
    aggregate.fixedWidthBitLength += stats.fixedWidthBitLength;
    aggregate.utf8BitLength += stats.utf8BitLength;
    aggregate.tokenCount += stats.tokenCount;
    aggregate.shortRankCount += stats.shortRankCount;
    aggregate.mediumRankCount += stats.mediumRankCount;
    aggregate.literalCount += stats.literalCount;

    console.log(
      [
        `plaintext="${plaintext}"`,
        `tokens=${stats.tokenCount}`,
        `compressed=${stats.compressedBitLength}b`,
        `layered=${layered.traditionalCompression.framedBitLength}b`,
        `layerFormat=${layered.traditionalCompression.format}`,
        `fixedWidth=${stats.fixedWidthBitLength}b`,
        `utf8=${stats.utf8BitLength}b`,
        `vsFixed=${stats.compressedToFixedWidthRatio.toFixed(3)}`,
        `vsUtf8=${stats.compressedToUtf8Ratio.toFixed(3)}`,
        `layerVsRank=${layered.traditionalCompression.ratioVsRankBitstring.toFixed(3)}`,
        `short=${stats.shortRankCount}`,
        `medium=${stats.mediumRankCount}`,
        `literal=${stats.literalCount}`,
      ].join(" | "),
    );
  }

  const fixedWidthRatio = aggregate.compressedBitLength / aggregate.fixedWidthBitLength;
  const utf8Ratio = aggregate.compressedBitLength / aggregate.utf8BitLength;
  const layeredVsRankRatio = aggregate.layeredBitLength / aggregate.compressedBitLength;

  console.log(
    [
      "aggregate",
      `tokens=${aggregate.tokenCount}`,
      `compressed=${aggregate.compressedBitLength}b`,
      `layered=${aggregate.layeredBitLength}b`,
      `fixedWidth=${aggregate.fixedWidthBitLength}b`,
      `utf8=${aggregate.utf8BitLength}b`,
      `vsFixed=${fixedWidthRatio.toFixed(3)}`,
      `vsUtf8=${utf8Ratio.toFixed(3)}`,
      `layerVsRank=${layeredVsRankRatio.toFixed(3)}`,
      `short=${aggregate.shortRankCount}`,
      `medium=${aggregate.mediumRankCount}`,
      `literal=${aggregate.literalCount}`,
    ].join(" | "),
  );

  assert.ok(fixedWidthRatio < 1, `expected compression to beat fixed-width token ids, got ${fixedWidthRatio}`);
});
