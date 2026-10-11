const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const SOVEREIGN_ADMIN = "0x00a3b4f0688734eF0C6086F126b12D5FFE2070DC";

async function main() {
  console.log("================================================================");
  console.log("AETHER-BRIDGE Production Multi-Chain Contract Deployment");
  console.log("================================================================");

  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("Active Network: " + network.name + " (Chain ID: " + chainId + ")");
  console.log("Deployer Account: " + deployer.address);
  console.log("Sovereign Primary Admin: " + SOVEREIGN_ADMIN);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer Native Gas Balance: " + hre.ethers.formatEther(balance));

  if (balance === 0n) {
    throw new Error("FATAL: Deployer account has 0 balance! Funds required for gas.");
  }

  const manifestPath = path.join(__dirname, "../contracts/deployment-manifest.json");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      manifest = {};
    }
  }

  const isEthereum = chainId === 1 || chainId === 11155111 || chainId === 31337;
  if (isEthereum) {
    console.log("\nDeploying LockContract on Source Chain...");
    const tokenAddressSource = process.env.SOURCE_TOKEN_ADDRESS || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

    const LockContractFactory = await hre.ethers.getContractFactory("LockContract");
    const lockContract = await LockContractFactory.deploy(SOVEREIGN_ADMIN, tokenAddressSource);
    await lockContract.waitForDeployment();
    const lockAddress = await lockContract.getAddress();
    console.log("LockContract deployed successfully to: " + lockAddress);

    manifest.sourceChain = {
      chainId: chainId,
      lockContract: lockAddress,
      token: tokenAddressSource,
      admin: SOVEREIGN_ADMIN,
      timestamp: Date.now()
    };
  }

  const isBsc = chainId === 56 || chainId === 97 || chainId === 31337;
  if (isBsc) {
    console.log("\nDeploying MintContract on Destination Chain...");
    const tokenAddressDest = process.env.DEST_TOKEN_ADDRESS || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
    const relayerAddress = process.env.RELAYER_WALLET_ADDRESS || deployer.address;

    const MintContractFactory = await hre.ethers.getContractFactory("MintContract");
    const mintContract = await MintContractFactory.deploy(SOVEREIGN_ADMIN, relayerAddress, tokenAddressDest);
    await mintContract.waitForDeployment();
    const mintAddress = await mintContract.getAddress();
    console.log("MintContract deployed successfully to: " + mintAddress);

    manifest.destChain = {
      chainId: chainId,
      mintContract: mintAddress,
      token: tokenAddressDest,
      relayer: relayerAddress,
      admin: SOVEREIGN_ADMIN,
      timestamp: Date.now()
    };
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log("\nSaved deployment manifest to: " + manifestPath);
  console.log("================================================================");
  console.log("DEPLOYMENT SEQUENCE COMPLETED WITH FULL PROTOCOL INTEGRITY");
  console.log("================================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
