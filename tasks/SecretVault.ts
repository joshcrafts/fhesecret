import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { decodeBytes32String, encodeBytes32String, getAddress, toBeHex, Wallet } from "ethers";

const MAX_SECRET_BYTES = 31;

function encodeSecretToUint256(secret: string): bigint {
  const length = Buffer.byteLength(secret, "utf8");
  if (length === 0) {
    throw new Error("Secret must not be empty");
  }
  if (length > MAX_SECRET_BYTES) {
    throw new Error(`Secret must be ${MAX_SECRET_BYTES} bytes or less`);
  }
  const encoded = encodeBytes32String(secret);
  return BigInt(encoded);
}

function decodeSecretFromUint256(value: bigint): string {
  const hexValue = toBeHex(value, 32);
  return decodeBytes32String(hexValue);
}

/**
 * Example:
 *   - npx hardhat --network localhost task:address
 *   - npx hardhat --network sepolia task:address
 */
task("task:address", "Prints the SecretVault address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;

  const secretVault = await deployments.get("SecretVault");

  console.log("SecretVault address is " + secretVault.address);
});

/**
 * Example:
 *   - npx hardhat --network localhost task:store-secret --secret "vault secret"
 *   - npx hardhat --network sepolia task:store-secret --secret "vault secret" --key 0x1234...
 */
task("task:store-secret", "Stores an encrypted secret and encrypted random address")
  .addOptionalParam("address", "Optionally specify the SecretVault contract address")
  .addOptionalParam("key", "Optional random address")
  .addParam("secret", "Secret string (max 31 bytes)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const SecretVaultDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("SecretVault");
    console.log(`SecretVault: ${SecretVaultDeployment.address}`);

    const signers = await ethers.getSigners();
    const signer = signers[0];

    const keyAddress = taskArguments.key ? getAddress(taskArguments.key) : Wallet.createRandom().address;
    const secretValue = encodeSecretToUint256(taskArguments.secret);

    const encryptedInput = await fhevm
      .createEncryptedInput(SecretVaultDeployment.address, signer.address)
      .addAddress(keyAddress)
      .add256(secretValue)
      .encrypt();

    const secretVaultContract = await ethers.getContractAt("SecretVault", SecretVaultDeployment.address);

    const tx = await secretVaultContract
      .connect(signer)
      .storeSecret(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);

    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
    console.log(`Stored secret with random address: ${keyAddress}`);
  });

/**
 * Example:
 *   - npx hardhat --network localhost task:decrypt-secret --index 0
 *   - npx hardhat --network sepolia task:decrypt-secret --index 0 --owner 0x1234...
 */
task("task:decrypt-secret", "Decrypts a stored secret entry")
  .addOptionalParam("address", "Optionally specify the SecretVault contract address")
  .addOptionalParam("owner", "Optional owner address")
  .addParam("index", "Entry index")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const index = Number(taskArguments.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("Index must be a non-negative integer");
    }

    await fhevm.initializeCLIApi();

    const SecretVaultDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("SecretVault");
    console.log(`SecretVault: ${SecretVaultDeployment.address}`);

    const signers = await ethers.getSigners();
    const signer = signers[0];
    const owner = taskArguments.owner ? getAddress(taskArguments.owner) : signer.address;

    const secretVaultContract = await ethers.getContractAt("SecretVault", SecretVaultDeployment.address);

    const entry = await secretVaultContract.getSecretEntry(owner, index);
    const encryptedKey = entry[0];
    const encryptedSecret = entry[1];

    const clearKey = await fhevm.userDecryptEuint(
      FhevmType.eaddress,
      encryptedKey,
      SecretVaultDeployment.address,
      signer,
    );

    const clearSecret = await fhevm.userDecryptEuint(
      FhevmType.euint256,
      encryptedSecret,
      SecretVaultDeployment.address,
      signer,
    );

    const decryptedAddress = getAddress(toBeHex(BigInt(clearKey), 20));
    const decryptedSecret = decodeSecretFromUint256(BigInt(clearSecret));

    console.log(`Decrypted random address: ${decryptedAddress}`);
    console.log(`Decrypted secret: ${decryptedSecret}`);
  });
