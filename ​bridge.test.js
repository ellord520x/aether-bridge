> node --test test/bridge.test.js

# Subtest: Aether-Bridge Omnichain Invariant & Security Verification
  ✓ 1. Strict 1:1 Parity: Locked amount must strictly equal minted amount (0.00% slashing)
  ✓ 2. Replay Prevention: Re-executing an existing nonce must throw a duplicate nonce error
  ✓ 3. Fee/Arbitrage Violation: Any attempt to deduct fees or modify amount fails instantly
tests 3 | pass 3 | fail 0 (100% Passing)
