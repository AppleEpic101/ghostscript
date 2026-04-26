# Plaintext Rank Compression Proposal

**Status:** Draft

## Overview

This document describes a proposed plaintext compression scheme for Ghostscript based on language-model token ranking.

The basic idea is:

- tokenize the plaintext with the pinned tokenizer
- for each token, compute that token's probability rank under the pinned model given the preceding plaintext tokens
- encode the token as a compact rank when the rank is small
- otherwise fall back to encoding the literal token id

This produces a lossless hybrid stream of rank references and literal token ids. Decoding is possible because the decoder reconstructs the same plaintext prefix token-by-token and can therefore reproduce the same next-token ranking at each step.

This is a source-coding scheme for plaintext compression. It is separate from Ghostscript's cover-text transport encoding scheme.

## Goals

- Losslessly compress plaintext prior to encryption.
- Exploit the language model's predictability on natural-language plaintext.
- Preserve deterministic decoding under a pinned model/tokenizer/config.
- Keep the binary format simple enough to implement and debug.

## Non-Goals

- Compatibility across model or tokenizer versions.
- Compression of arbitrary binary files.
- Robustness to model drift.
- Steganographic concealment.

## Shared Configuration

The encoder and decoder must agree exactly on:

- tokenizer and tokenizer version
- model checkpoint and inference precision
- special-token policy
- beginning-of-sequence handling
- context truncation rule
- ranking rule: descending raw logit
- tie-break rule: ascending token id
- text normalization rules, if any

Any mismatch will corrupt the remainder of the stream from the first divergent token onward.

## Token Ranking Rule

For each plaintext token position:

1. Take the already-encoded plaintext token prefix.
2. Run the language model on that prefix.
3. Obtain the next-token logits over the vocabulary.
4. Sort all candidate token ids by:
   - descending raw logit
   - ascending token id as a deterministic tie-breaker
5. Find the rank of the actual plaintext token in that ordering.

The codec uses raw-logit ordering only. It does not require softmax, temperature scaling, or probability thresholding.

## Binary Encoding Format

The compressed stream is a bitstream with three symbol forms.

### 1. Short rank form

Used when the token rank is between `0` and `7`.

Bit layout:

```text
0 rrr
```

- total length: `4` bits
- value range: `0..7`

This is the expected common case and allows two short-rank symbols to fit exactly in one byte.

### 2. Medium rank form

Used when the token rank is between `8` and `127`.

Bit layout:

```text
10 rrrrrrr
```

- total length: `9` bits
- value range: `8..127`

Values `0..7` are forbidden in this form and must use the short rank form instead.

### 3. Literal token-id form

Used when the token rank is `128` or greater.

Bit layout:

```text
11 <token-id-varint>
```

The token id is encoded using a base-128 variable-length integer with 8-bit groups:

```text
c ddddddd
```

- `c = 1` means another group follows
- `c = 0` means this is the final group
- the payload bits `ddddddd` encode the token id in base-128 little-endian form

This is analogous to an unsigned LEB128-style integer.

## Canonical Encoding Rule

To keep the format deterministic and unambiguous:

- if `rank < 8`, encode using short rank form
- else if `rank < 128`, encode using medium rank form
- else, encode using literal token-id form

An encoder must always choose the shortest valid canonical representation from the three forms above according to this rule.

## Encoding Procedure

Given a plaintext string:

1. Normalize the plaintext if the protocol defines normalization.
2. Tokenize the plaintext into token ids `t[0..n-1]` with special tokens disabled unless explicitly specified otherwise.
3. Initialize an empty output bitstream.
4. For each token `t[i]`:
   - build the model context from `t[0..i-1]`
   - apply the configured context truncation rule if needed
   - run the model to obtain next-token logits
   - rank the vocabulary by descending raw logit with ascending token-id tie-break
   - let `r` be the rank of `t[i]`
   - emit:
     - `0 rrr` if `r < 8`
     - `10 rrrrrrr` if `8 <= r < 128`
     - `11 <token-id-varint(t[i])>` otherwise
5. Emit or externally carry the total bit length using the surrounding framing layer.

## Decoding Procedure

Given the compressed bitstream:

1. Initialize an empty decoded token list `T`.
2. Repeat until the framed bitstream is exhausted:
   - read the first prefix bit
   - if it is `0`:
     - read the next `3` bits as rank `r`
     - rebuild the token ranking from the current decoded prefix `T`
     - select the token id at rank `r`
   - otherwise read the second prefix bit
   - if the prefix is `10`:
     - read the next `7` bits as rank `r`
     - validate that `r >= 8`
     - rebuild the token ranking from the current decoded prefix `T`
     - select the token id at rank `r`
   - if the prefix is `11`:
     - read a token-id varint
     - use that token id directly
   - append the recovered token id to `T`
3. Detokenize `T` to recover the plaintext string.

## Framing Requirements

This codec should not rely on end-of-stream ambiguity. It should be wrapped by a higher-level framing layer that provides enough information to stop decoding safely.

Recommended outer metadata:

- codec version
- model or tokenizer config id
- compressed payload bit length
- optional plaintext byte length
- optional plaintext token count

## Correctness Requirements

Encoder and decoder must agree exactly on:

- tokenization
- BOS handling
- context truncation
- model precision and weights
- tie-break behavior
- literal token-id varint interpretation

If the model state diverges at any step, all subsequent rank-coded tokens may decode incorrectly.

## Expected Compression Behavior

Per token, the bit cost is:

- rank `0..7`: `4` bits
- rank `8..127`: `9` bits
- rank `128+`: `2 + varint(token_id)` bits

Compression is good only when a large fraction of plaintext tokens fall into very small ranks. If many tokens land outside the top `127`, the literal fallback rate may dominate and the codec may perform worse than conventional compression.

## Example Symbol Costs

If a plaintext token sequence produces ranks:

```text
2, 0, 11, 3, 241+, 1
```

then the encoded forms would be:

- `2` -> short rank -> `0 010`
- `0` -> short rank -> `0 000`
- `11` -> medium rank -> `10 0001011`
- `3` -> short rank -> `0 011`
- `241+` -> literal token-id form -> `11 <varint(token_id)>`
- `1` -> short rank -> `0 001`

The actual decoded token for each rank is determined from the model ranking at that position, not from the rank value alone.

## Advantages

- Simple lossless design.
- Exploits model predictability directly.
- Cheap representation for highly predictable tokens.
- Straightforward fallback path for rare or surprising tokens.

## Limitations

- Requires a full model forward pass per plaintext token during both encode and decode.
- Completely coupled to the pinned model/tokenizer/config.
- Sensitive to context truncation mismatches.
- May compress poorly on unusual language, code, names, or mixed-format text.
- Likely slower and more fragile than ordinary byte-level compression such as deflate.

## Suggested Evaluation Plan

Benchmark this codec against `deflate` on representative Ghostscript plaintexts.

Measure:

- average compressed bits per plaintext byte
- fraction of tokens with ranks `0..7`
- fraction of tokens with ranks `8..127`
- fraction of tokens requiring literal token-id fallback
- encode latency
- decode latency

Suggested corpora:

- short chat replies
- medium conversational messages
- messages with names, URLs, emoji, and slang
- multilingual samples if those matter for product scope

## Recommended Future Improvement

The current proposal uses a fixed threshold:

- ranks below `128` are encoded by rank
- ranks `128+` are encoded as literal token ids

A stronger future variant would compare the actual encoded cost of:

- rank representation
- literal token-id representation

and choose whichever is shorter. That would preserve the same general architecture while improving compression efficiency.

## Summary

This proposal defines a deterministic hybrid rank-or-literal plaintext compression scheme:

- use compact rank codes for highly predictable tokens
- use literal token ids for poorly predicted tokens
- reconstruct the same rankings during decode from the recovered plaintext prefix

It is a viable experimental codec, but its real value depends on empirical compression results versus simpler alternatives such as `deflate`.
