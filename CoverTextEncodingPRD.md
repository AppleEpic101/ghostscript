# PRD: LLM-Based Lossless Bit-to-Natural-Language Encoding

**Status:** Draft  
**Version:** 0.1

---

## 1. Overview

This document describes a scheme for encoding an arbitrary bitstream into a sequence of natural-language tokens, and recovering the exact original bitstream from that token sequence. The resulting text is indistinguishable from normal LLM output on the byte level — no invisible characters, no structural artifacts, no steganographic markers.

The scheme is based on **rank-selection encoding**: at each generation step, the encoder selects a token by its rank in the LLM's probability distribution, where the rank encodes `n` bits of the payload. A shared set of preconditions filters the candidate pool deterministically so that both encoder and decoder agree on the same ranked list at every step.

---

## 2. Goals

- **Lossless:** The exact original bitstream must be recoverable from the token sequence.
- **Natural output:** The generated text must be indistinguishable from normal LLM output at the byte level. No invisible Unicode, no structural tricks.
- **Deterministic decoding:** Given the token sequence and the same model/config, the decoder must always recover the same bits.
- **Tunable capacity:** The number of bits encoded per token (`n`) is a configurable hyperparameter.
- **Robustness:** The scheme should degrade gracefully when the candidate pool is small (e.g., near end-of-sequence or highly constrained contexts).

---

## 3. Non-Goals

- Steganographic secrecy (adversarial undetectability is not a requirement).
- Compatibility across different models or tokenizers.
- Support for streaming or online decoding (offline batch processing is sufficient).
- Human readability of the encoding scheme itself.

---

## 4. Scheme Description

### 4.1 Parameters

| Parameter | Symbol | Description |
|---|---|---|
| Bits per step | `n` | Number of bits encoded per token. Candidate pool size = `2ⁿ`. Tunable hyperparameter. |
| Probability threshold | `p_min` | Minimum raw probability a token must have to enter the candidate pool. Applied after temperature scaling. |
| Temperature | `T` | Softmax temperature applied to logits before thresholding. Affects pool size and token distribution. |
| Excluded token set | `X` | Set of token IDs always excluded from the candidate pool (e.g. EOS, BOS, PAD, and other special tokens). |
| Model | `M` | The LLM used for generation. Must be identical and identically configured on both encoder and decoder sides. |

### 4.2 Candidate Pool Construction

At each generation step, given the current token context, the candidate pool `C` is constructed as follows:

1. **Get logits.** Query `M` with the current context to obtain raw logits over the full vocabulary.
2. **Apply temperature.** Scale logits by `1/T`, then softmax to obtain probabilities `P`.
3. **Exclude special tokens.** Remove all token IDs in `X` from consideration.
4. **Apply probability threshold.** Retain only tokens where `P(t) ≥ p_min`.
5. **Apply merge-safety filter.** Remove any token `t` where appending `t` to the previous token would not survive a retokenization roundtrip:
    ```
    decode([prev_token, t]) retokenized ≠ [prev_token, t]  →  exclude t
    ```
6. **Sort by descending probability.** The remaining tokens, sorted by `P(t)` descending, form the ordered candidate pool `C = [c₁, c₂, ..., cₖ]`.

The pool must contain at least `2ⁿ` tokens to encode a full `n`-bit chunk. See Section 4.5 for fallback behavior when it does not.

### 4.3 Encoding: Bits → Tokens

Given a payload bitstream `B` and a starting context (e.g. a prompt), the encoder proceeds as follows:

1. Read the next `n` bits from `B` as an unsigned integer `i` (0-indexed, big-endian).
2. Construct the candidate pool `C` as described in 4.2.
3. Select token `cᵢ` (the token at 0-indexed rank `i`).
4. Append `cᵢ` to the context and the output token sequence.
5. Repeat until all bits are consumed.
6. Emit a termination signal (see Section 4.6).

### 4.4 Decoding: Tokens → Bits

Given the token sequence and the same starting context:

1. For each token `t` in the sequence (up to the termination signal):
2. Construct the candidate pool `C` using the identical procedure (same model, same parameters, same context up to this point).
3. Find the rank `i` of `t` in `C` (0-indexed).
4. Emit `i` as `n` bits (big-endian).
5. Append `t` to the context and continue.

Because both sides use the same model and parameters, they construct identical candidate pools at every step, guaranteeing lossless recovery.

### 4.5 Fallback: Insufficient Pool Size

When `|C| < 2ⁿ`, the encoder cannot encode a full `n`-bit chunk. The fallback strategy (choose one at configuration time):

- **Reduce bits for this step:** Encode `floor(log₂(|C|))` bits instead. Both sides must agree on this rule — the decoder infers the reduced width from the pool size.
- **Skip step:** Emit no bits and use the top-ranked token (`c₀`) deterministically. The decoder sees `|C| < 2ⁿ` and emits no bits for this step.
- **Abort generation:** Treat this as an error condition. Useful for debugging or when bit density guarantees are required.

The recommended default is **reduce bits**, as it preserves fluency and wastes no capacity.

### 4.6 Termination

The payload length in bits must be known to the decoder to avoid emitting trailing junk bits. Two options:

- **Length header:** Encode the payload length as a fixed-width integer in the first few tokens before the payload begins.
- **Out-of-band:** Transmit the length separately. Simpler but requires a side channel.

A sentinel token from `X` (e.g. EOS) can be appended at the end of the token sequence to signal completion.

---

## 5. Merge-Safety Invariant

The merge-safety filter (step 5 of Section 4.2) ensures that the generated token sequence survives detokenization and retokenization intact.

**Claim:** If at every step, the appended token passes the pairwise merge-safety check against the previous token, then the full sequence satisfies:

```
tokenize(detokenize([t₁, t₂, ..., tₙ])) == [t₁, t₂, ..., tₙ]
```

**Proof sketch (by induction):**

- *Base case:* A single token `[t₁]` is individually roundtrip-safe by assumption (enforced at generation start).
- *Inductive step:* Assume `[t₁, ..., tₖ]` is roundtrip-safe. BPE merge rules operate on adjacent pairs in the flat string. Appending `tₖ₊₁` introduces exactly one new boundary: between `tₖ` and `tₖ₊₁`. All prior boundaries are unaffected. The merge-safety check verifies that no merge rule spans this new boundary. Therefore `[t₁, ..., tₖ₊₁]` is also roundtrip-safe. ∎

**Implementation:**

```python
def is_safe_append(tokenizer, prev_token_id: int, new_token_id: int) -> bool:
    pair_string = tokenizer.decode([prev_token_id, new_token_id])
    return tokenizer.encode(pair_string) == [prev_token_id, new_token_id]
```

This check is O(1) per token and adds negligible overhead.

---

## 6. Capacity Analysis

The number of bits encoded per token is:

```
bits_per_token = n           (when |C| ≥ 2ⁿ)
bits_per_token < n           (fallback steps)
```

The pool size `|C|` depends on:

- **Temperature `T`:** Higher temperature flattens the distribution, pushing more tokens above `p_min`, increasing pool size and bit density.
- **Threshold `p_min`:** Lower threshold admits more tokens, increasing pool size.
- **Context:** Highly predictable contexts concentrate probability mass on few tokens, shrinking the pool. Novel or creative contexts spread mass, growing the pool.

In practice, for a modern large language model with `T = 1.0` and `p_min = 0.001`, pool sizes of 10–100 tokens per step are typical, comfortably supporting `n = 3` (8 candidates) or `n = 4` (16 candidates) for most steps.

---

## 7. Correctness Requirements

Both encoder and decoder must agree exactly on:

| Requirement | Notes |
|---|---|
| Model weights | Identical checkpoint, identical quantization |
| Inference precision | fp32 / bf16 must match; different hardware may produce different logits |
| Temperature `T` | Identical value |
| Threshold `p_min` | Identical value |
| Excluded token set `X` | Identical set |
| Sort order tie-breaking | When two tokens have identical probability, a deterministic secondary sort key must be defined (e.g. ascending token ID) |
| Context window management | If the context exceeds the model's window, both sides must apply the same truncation strategy |
| Tokenizer version | Must be identical; tokenizer updates can change token IDs |

Any divergence in the above will cause the decoder to construct a different candidate pool at some step, corrupting all subsequent bits.

---

## 8. Known Limitations

- **Compute cost:** Every token requires a full LLM forward pass. Decoding is as expensive as encoding.
- **Fragility to model updates:** Any change to model weights or tokenizer breaks existing encoded texts.
- **Bit density variability:** Low-entropy contexts (e.g. middle of a well-structured sentence) reduce pool size and drop below `n` bits/token frequently.
- **First-token edge case:** The merge-safety check requires a previous token. The first token must be individually verified for roundtrip safety against the start-of-sequence context.
- **Tie-breaking must be specified:** Floating-point probability ties are rare but possible; the tie-breaking rule must be part of the specification.

---

## 9. Open Questions

- What is the optimal value of `n`? Higher `n` increases density but increases fallback frequency and degrades text quality (lower-ranked tokens are less natural). Empirical benchmarking needed.
- Should `p_min` be absolute or relative to the top token's probability?
- Is a prompt/context prefix needed to steer the LLM toward a particular domain or style, and if so, does it need to be standardized?
- How should the scheme handle multi-byte UTF-8 tokens that are individually safe but whose string boundaries interact with BOS/EOS context in unusual ways?