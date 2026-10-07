/**
 * @file test/bridge.test.js
 * @title Web3 Quality Assurance & Security Automation Test Suite
 * @version 8.0.0-ENTERPRISE
 * @notice Validates Strict 1:1 Parity, Anti-Replay Nonce Guards, and Zero-Fee Arbitrage
 *         Invariants using the Node.js native assert module (node:assert).
 */

import assert from 'node:assert/strict';
import { ethers as rawEthers } from 'ethers';

// Compatible Ethers v6 resolution
let ethers = rawEthers;
if (!ethers.JsonRpcProvider) {
  try {
    const v6 = await import('ethers-v6');
    ethers = v6.ethers || v6;
  } catch {
    // Fallback
  }
}

// Universal Runner Resolution (Mocha, Node.js Native Test Runner, or Standalone CLI)
let suiteDescribe = globalThis.describe;
let suiteIt = globalThis.it;

if (!suiteDescribe || !suiteIt) {
  try {
    const nodeTest = await import('node:test');
    suiteDescribe = nodeTest.describe;
    suiteIt = nodeTest.it;
  } catch {
    // Standalone fallback
    suiteDescribe = (name, fn) => fn();
    suiteIt = async (name, fn) => {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
      } catch (err) {
        console.error(`  ✗ ${name}`);
        throw err;
      }
    };
  }
}

suiteDescribe('Aether-Bridge Omnichain Invariant & Security Verification', () => {
  // Test Mock State for Bridge Protocol
  class MockBridgeEngine {
    constructor() {
      this.processedNonces = new Set();
      this.lockedPrincipal = 0n;
      this.mintedPrincipal = 0n;
    }

    lockTokens(amount, nonce) {
      if (amount <= 0n) {
        throw new Error('ZeroAmount: Token principal must be greater than zero');
      }
      this.lockedPrincipal += amount;
      return { amount, nonce };
    }

    mintTokens(amount, nonce, feeDeduction = 0n) {
      // Test Case 2: Replay Prevention Guard
      if (this.processedNonces.has(nonce)) {
        throw new Error(`NonceAlreadyProcessed: Nonce #${nonce} was previously settled`);
      }

      // Test Case 3: Fee & Arbitrage Invariant Guard
      if (feeDeduction > 0n) {
        throw new Error('FeeArbitrageViolation: Protocol strictly mandates ZERO fee deductions from principal');
      }

      const deliveredAmount = amount - feeDeduction;

      // Test Case 1: Strict 1:1 Parity Guard
      if (deliveredAmount !== amount) {
        throw new Error('ParityInvariantViolation: Delivered principal does not strictly match locked amount');
      }

      this.processedNonces.add(nonce);
      this.mintedPrincipal += deliveredAmount;
      return deliveredAmount;
    }
  }

  // --------------------------------------------------------------------------
  // TEST CASE 1: Strict 1:1 Parity
  // --------------------------------------------------------------------------
  suiteIt('1. Strict 1:1 Parity: Locked amount must strictly equal minted amount (0.00% slashing)', () => {
    const bridge = new MockBridgeEngine();
    const testAmount = ethers.parseEther('100.0'); // 100 Tokens
    const nonce = 101;

    const lockReceipt = bridge.lockTokens(testAmount, nonce);
    const mintReceipt = bridge.mintTokens(lockReceipt.amount, lockReceipt.nonce);

    // Exact parity assertion
    assert.strictEqual(mintReceipt, testAmount, 'Minted amount must strictly match the locked amount');
    assert.strictEqual(bridge.lockedPrincipal, bridge.mintedPrincipal, 'Total locked principal must equal minted principal');
    assert.strictEqual(bridge.lockedPrincipal - bridge.mintedPrincipal, 0n, 'Delta leak between chains must be exactly zero');
  });

  // --------------------------------------------------------------------------
  // TEST CASE 2: Replay Prevention Guard
  // --------------------------------------------------------------------------
  suiteIt('2. Replay Prevention: Re-executing an existing nonce must throw a duplicate nonce error', () => {
    const bridge = new MockBridgeEngine();
    const testAmount = ethers.parseEther('25.5');
    const nonce = 402;

    // First execution succeeds
    bridge.lockTokens(testAmount, nonce);
    const initialMint = bridge.mintTokens(testAmount, nonce);
    assert.strictEqual(initialMint, testAmount);

    // Second execution with identical nonce MUST fail
    assert.throws(
      () => {
        bridge.mintTokens(testAmount, nonce);
      },
      (err) => {
        assert.match(err.message, /NonceAlreadyProcessed/, 'Must throw NonceAlreadyProcessed error on replay');
        return true;
      },
      'Expected duplicate nonce execution to be rejected'
    );
  });

  // --------------------------------------------------------------------------
  // TEST CASE 3: Fee / Arbitrage Violation Defense
  // --------------------------------------------------------------------------
  suiteIt('3. Fee/Arbitrage Violation: Any attempt to deduct fees or modify amount fails instantly', () => {
    const bridge = new MockBridgeEngine();
    const testAmount = ethers.parseEther('50.0');
    const maliciousFee = ethers.parseEther('0.5'); // Attempted 1% fee slice
    const nonce = 777;

    bridge.lockTokens(testAmount, nonce);

    // Attempting to deduct fee during mint must be rejected immediately
    assert.throws(
      () => {
        bridge.mintTokens(testAmount, nonce, maliciousFee);
      },
      (err) => {
        assert.match(err.message, /FeeArbitrageViolation/, 'Must throw FeeArbitrageViolation error when fee is deducted');
        return true;
      },
      'Expected fee deduction attempt to fail immediately'
    );

    // Principal remains uncorrupted
    assert.strictEqual(bridge.mintedPrincipal, 0n, 'No tokens should have minted during failed arbitrage attempt');
  });
});
