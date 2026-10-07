const latestBlock = await this.ethProvider.getBlockNumber();
const CONFIRMATION_DEPTH = 12;
const safeBlock = Math.max(0, latestBlock - CONFIRMATION_DEPTH);

if (this.lastProcessedBlock === 0) {
  this.lastProcessedBlock = Math.max(0, safeBlock - 2);
}

if (safeBlock > this.lastProcessedBlock) {
  const fromBlock = this.lastProcessedBlock + 1;
  const toBlock = Math.min(safeBlock, fromBlock + 15);
  // Safe event filter execution
}
