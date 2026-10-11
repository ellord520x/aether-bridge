const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const sourceRpc = process.env.SOURCE_RPC;
const destRpc = process.env.DEST_RPC;
const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY;

if (!sourceRpc || !destRpc || !relayerPrivateKey) {
    console.error("FATAL: Missing environment variables for relayer RPC or private key.");
    process.exit(1);
}

const sourceProvider = new ethers.JsonRpcProvider(sourceRpc);
const destProvider = new ethers.JsonRpcProvider(destRpc);
const relayerWallet = new ethers.Wallet(relayerPrivateKey, destProvider);

const manifestPath = path.join(__dirname, "../contracts/deployment-manifest.json");
let manifest = {};
if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

const lockAddress = process.env.LOCK_CONTRACT_ADDRESS || manifest?.sourceChain?.lockContract;
const mintAddress = process.env.MINT_CONTRACT_ADDRESS || manifest?.destChain?.mintContract;

if (!lockAddress || !mintAddress) {
    console.error("FATAL: Contract addresses not found in environment or deployment manifest.");
    process.exit(1);
}

const lockAbi = ["event LockEvent(address indexed sender, address indexed receiver, uint256 amount, uint256 nonce)"];
const mintAbi = ["function mintTokens(address receiver, uint256 amount, uint256 nonce) external"];

const sourceContract = new ethers.Contract(lockAddress, lockAbi, sourceProvider);
const destContract = new ethers.Contract(mintAddress, mintAbi, relayerWallet);

async function startRelayer() {
    console.log("================================================================");
    console.log("AETHER-BRIDGE Autonomous Relayer Daemon Initialized");
    console.log("Source Contract: " + lockAddress);
    console.log("Destination Contract: " + mintAddress);
    console.log("================================================================");

    sourceContract.on("LockEvent", async (sender, receiver, amount, nonce, event) => {
        console.log("\nDetected LockEvent on Source Chain:");
        console.log("Sender: " + sender);
        console.log("Receiver: " + receiver);
        console.log("Amount: " + amount.toString());
        console.log("Nonce: " + nonce.toString());
        console.log("Tx Hash: " + event.log.transactionHash);

        try {
            console.log("Executing mint transaction on destination chain...");
            const tx = await destContract.mintTokens(receiver, amount, nonce);
            console.log("Mint transaction broadcasted: " + tx.hash + ". Waiting for confirmation...");
            const receipt = await tx.wait();
            console.log("Mint confirmed successfully in block " + receipt.blockNumber + "!");
        } catch (error) {
            console.error("ERROR executing mint transaction:", error);
        }
    });
}

startRelayer().catch((error) => {
    console.error("FATAL Relayer Error:", error);
    process.exit(1);
});
