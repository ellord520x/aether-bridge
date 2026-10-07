/**
 * @file hardhat.config.cjs
 * @title Hardhat Configuration for Aether-Bridge Mainnet Deployments
 * @version 8.0.0-ENTERPRISE
 * @notice CommonJS Standard Hardhat configuration for Ethereum Mainnet and BSC Mainnet.
 */

require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const accounts = process.env.RELAYER_PRIVATE_KEY ? [process.env.RELAYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    ethereumMainnet: {
      url: process.env.ETH_MAINNET_RPC_URL || 'https://eth.llamarpc.com',
      chainId: 1,
      accounts: accounts
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org/',
      chainId: 56,
      accounts: accounts
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
