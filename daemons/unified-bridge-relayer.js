/**
 * @file daemons/unified-bridge-relayer.js
 * @title Aether-Bridge Mainnet Relayer Daemon (Ethers.js v6)
 * @version 8.0.0-ENTERPRISE
 * @notice Listens for TokensLocked events on Ethereum Mainnet LockContract,
 *         verifies isNonceProcessed on BSC MintContract, and executes mintTokens
 *         with 1:1 asset parity, exponential backoff resilience, and Sentry webhook telemetry.
 */

import { ethers as rawEthers } from 'ethers';
import https from 'node:https';
import http from 'node:http';
import dotenv from 'dotenv';

dotenv.config();

// Resolve Ethers.js v6 compatibility
let ethers = rawEthers;
if (!ethers.JsonRpcProvider) {
  try {
    const v6 = await import('ethers-v6');
    ethers = v6.ethers || v6;
  } catch {
    // Fallback
  }
}

// ============================================================================
// 1. CONFIGURATION & SENTRY TELEMETRY DISPATCHER
// ============================================================================

const CONFIG = {
  ethRpcUrl: process.env.ETH_MAINNET_RPC_URL || 'https://eth.llamarpc.com',
  bscRpcUrl: process.env.BSC_MAINNET_RPC_URL || 'https://binance.llamarpc.com',
  lockContractAddress: (process.env.LOCK_CONTRACT_ADDRESS || '0x32A42111E935c6E0c663F023DbD1eFa8c9c0F19E').trim(),
  mintContractAddress: (process.env.MINT_CONTRACT_ADDRESS || '0x71C7656EC7ab88b098defB751B7401B5f6d8976F').trim(),
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY || '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
  sentryWebhookUrl: process.env.SENTRY_WEBHOOK_URL || process.env.SENTRY_DSN || null,
  pollIntervalMs: 5000,
  maxRetries: 5,
  baseBackoffMs: 1000
};

// Contract ABIs
const LOCK_CONTRACT_ABI = [
  'event TokensLocked(address indexed sender, uint256 amount, uint256 nonce, string targetChain)',
  'function globalNonce() external view returns (uint256)',
  'function paused() external view returns (bool)'
];

const MINT_CONTRACT_ABI = [
  'function mintTokens(address to, uint256 amount, uint256 nonce) external',
  'function isNonceProcessed(uint256 nonce) external view returns (bool)',
  'function relayerAddress() external view returns (address)',
  'function paused() external view returns (bool)'
];

/**
 * Dispatches detailed JSON error payload to Sentry Webhook / Log Ingestion
 */
function dispatchSentryTelemetry(errorPayload) {
  const telemetry = {
    timestamp: new Date().toISOString(),
    service: 'aether-mainnet-relayer',
    level: 'error',
    platform: 'node',
    environment: process.env.NODE_ENV || 'production',
    ...errorPayload
  };

  // Structured stderr JSON for Sentry / CloudWatch / Datadog collectors
  process.stderr.write(`[SENTRY-TELEMETRY] ${JSON.stringify(telemetry, null, 2)}\n`);

  if (CONFIG.sentryWebhookUrl && CONFIG.sentryWebhookUrl.startsWith('http')) {
    try {
      const url = new URL(CONFIG.sentryWebhookUrl);
      const data = JSON.stringify(telemetry);
      const reqModule = url.protocol === 'https:' ? https : http;

      const req = reqModule.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 4000
      });

      req.on('error', (e) => {
        process.stderr.write(`[SENTRY-DISPATCH-ERR] ${e.message}\n`);
      });

      req.write(data);
      req.end();
    } catch (e) {
      process.stderr.write(`[SENTRY-POST-FAIL] ${e.message}\n`);
    }
  }
}

// ============================================================================
// 2. MAINNET RELAYER DAEMON CLASS
// ============================================================================

export class MainnetBridgeRelayer {
  constructor() {
    this.lastProcessedBlock = 0;
    this.inFlightNonces = new Set();
    this.isRunning = false;
    this.initProviders();
  }

  initProviders() {
    console.log('Connecting to Ethereum & BSC Mainnet RPC endpoints...');
    this.ethProvider = new ethers.JsonRpcProvider(CONFIG.ethRpcUrl, undefined, {
      staticNetwork: ethers.Network.from(1)
    });

    this.bscProvider = new ethers.JsonRpcProvider(CONFIG.bscRpcUrl, undefined, {
      staticNetwork: ethers.Network.from(56)
    });

    // Relayer Signer Wallet on BSC
    const rawKey = CONFIG.relayerPrivateKey.startsWith('0x')
      ? CONFIG.relayerPrivateKey
      : `0x${CONFIG.relayerPrivateKey.padStart(64, '0')}`;
    this.bscSigner = new ethers.Wallet(rawKey, this.bscProvider);

    // Contract Instances
    this.lockContract = new ethers.Contract(CONFIG.lockContractAddress, LOCK_CONTRACT_ABI, this.ethProvider);
    this.mintContract = new ethers.Contract(CONFIG.mintContractAddress, MINT_CONTRACT_ABI, this.bscSigner);

    console.log(`✓ Relayer Wallet Loaded: ${this.bscSigner.address}`);
    console.log(`✓ LockContract Target:   ${CONFIG.lockContractAddress}`);
    console.log(`✓ MintContract Target:   ${CONFIG.mintContractAddress}`);
  }

  /**
   * Exponential backoff retry wrapper for RPC & transaction executions
   */
  async executeWithBackoff(operation, context = 'RPC_CALL') {
    let attempt = 0;
    while (attempt < CONFIG.maxRetries) {
      try {
        return await operation();
      } catch (err) {
        attempt++;
        const backoffMs = CONFIG.baseBackoffMs * Math.pow(2, attempt - 1);
        console.warn(`[RETRY-${attempt}/${CONFIG.maxRetries}] ${context} failed: ${err.message}. Retrying in ${backoffMs}ms...`);

        if (attempt >= CONFIG.maxRetries) {
          dispatchSentryTelemetry({
            exception: err.message,
            stack: err.stack,
            context,
            attempts: attempt,
            fatal: true
          });
          throw err;
        }

        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  /**
   * Processes an individual TokensLocked event
   */
  async processTokensLockedEvent(sender, amount, nonce, targetChain, eventObj) {
    const nonceNumber = Number(nonce);

    if (this.inFlightNonces.has(nonceNumber)) {
      return;
    }

    this.inFlightNonces.add(nonceNumber);

    try {
      console.log(`\n================================================================================`);
      console.log(`📥 INBOUND LOCK EVENT DETECTED (Ethereum Mainnet)`);
      console.log(`   - Sender:      ${sender}`);
      console.log(`   - Amount:      ${ethers.formatEther(amount)} Tokens (1:1 Parity)`);
      console.log(`   - Nonce:       ${nonceNumber}`);
      console.log(`   - TargetChain: ${targetChain}`);
      console.log(`   - TxHash:      ${eventObj.log?.transactionHash || 'N/A'}`);
      console.log(`================================================================================`);

      // 1. Verify Nonce State on BSC MintContract
      const isProcessed = await this.executeWithBackoff(
        () => this.mintContract.isNonceProcessed(nonceNumber),
        `CHECK_NONCE_${nonceNumber}`
      );

      if (isProcessed) {
        console.log(`ℹ️ Nonce #${nonceNumber} is already settled on BSC. Skipping duplicate execution.`);
        return;
      }

      // 2. Fetch Gas Price & Size Buffer for BSC
      const feeData = await this.executeWithBackoff(
        () => this.bscProvider.getFeeData(),
        'FETCH_BSC_FEE_DATA'
      );

      const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 125n) / 100n : 5000000000n; // 1.25x buffer

      console.log(`🚀 Dispatching mintTokens(${sender}, ${amount}, ${nonceNumber}) on BSC Mainnet...`);

      // 3. Broadcast Mint Transaction on BSC
      const tx = await this.executeWithBackoff(
        () => this.mintContract.mintTokens(sender, amount, nonceNumber, {
          gasPrice,
          gasLimit: 300000n
        }),
        `BROADCAST_MINT_${nonceNumber}`
      );

      console.log(`⏳ Mint transaction broadcasted: ${tx.hash}`);

      // 4. Wait for 1 Confirmation
      const receipt = await tx.wait(1);

      if (receipt.status === 1) {
        console.log(`✅ MINT CONFIRMED ON BSC MAINNET!`);
        console.log(`   - Block:       ${receipt.blockNumber}`);
        console.log(`   - TxHash:      ${receipt.hash}`);
        console.log(`   - Gas Used:    ${receipt.gasUsed.toString()}`);
        console.log(`🎉 1:1 Exact Token Parity Settled across Ethereum -> BSC.\n`);
      } else {
        throw new Error(`Transaction reverted on BSC: ${receipt.hash}`);
      }
    } catch (err) {
      dispatchSentryTelemetry({
        exception: err.message,
        stack: err.stack,
        sender,
        amount: amount.toString(),
        nonce: nonceNumber,
        targetChain,
        sourceTx: eventObj.log?.transactionHash
      });
      console.error(`❌ Relay failed for Nonce #${nonceNumber}: ${err.message}`);
    } finally {
      this.inFlightNonces.delete(nonceNumber);
    }
  }

  /**
   * Continuous event polling & listener with resilient reconnect loop
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🛰️ Aether-Bridge Mainnet Relayer Daemon is LIVE and monitoring...');

    const scanCycle = async () => {
      if (!this.isRunning) return;

      try {
        const latestBlock = await this.executeWithBackoff(
          () => this.ethProvider.getBlockNumber(),
          'GET_ETH_BLOCK_NUMBER'
        );

        if (this.lastProcessedBlock === 0) {
          this.lastProcessedBlock = latestBlock - 2;
        }

        if (latestBlock > this.lastProcessedBlock) {
          const fromBlock = this.lastProcessedBlock + 1;
          const toBlock = Math.min(latestBlock, fromBlock + 15);

          const filter = this.lockContract.filters.TokensLocked();
          const logs = await this.executeWithBackoff(
            () => this.lockContract.queryFilter(filter, fromBlock, toBlock),
            `QUERY_LOCKS_${fromBlock}_${toBlock}`
          );

          for (const log of logs) {
            const parsed = this.lockContract.interface.parseLog(log);
            if (parsed && parsed.name === 'TokensLocked') {
              const { sender, amount, nonce, targetChain } = parsed.args;
              await this.processTokensLockedEvent(sender, amount, nonce, targetChain, { log });
            }
          }

          this.lastProcessedBlock = toBlock;
        }
      } catch (err) {
        dispatchSentryTelemetry({
          exception: err.message,
          context: 'SCAN_CYCLE_ERROR'
        });
        console.warn(`[POLL-LOOP-WARN] ${err.message}`);
      }
    };

    this.timer = setInterval(scanCycle, CONFIG.pollIntervalMs);
    scanCycle();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    console.log('🛑 Relayer Daemon stopped.');
  }
}

// ============================================================================
// 3. PROCESS ENTRYPOINT & CRASH PROTECTION
// ============================================================================

process.on('uncaughtException', (err) => {
  dispatchSentryTelemetry({
    exception: err.message,
    stack: err.stack,
    context: 'UNCAUGHT_EXCEPTION'
  });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : null;
  dispatchSentryTelemetry({
    exception: msg,
    stack,
    context: 'UNHANDLED_REJECTION'
  });
});

if (process.argv[1] && process.argv[1].endsWith('unified-bridge-relayer.js')) {
  const relayer = new MainnetBridgeRelayer();
  relayer.start();

  process.on('SIGINT', () => {
    relayer.stop();
    process.exit(0);
  });
}
