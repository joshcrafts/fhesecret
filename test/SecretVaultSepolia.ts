import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { SecretVault } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const MAX_SECRET_BYTES = 31;

type Signers = {
  alice: HardhatEthersSigner;
};

function encodeSecret(secret: string): bigint {
  const length = Buffer.byteLength(secret, "utf8");
  if (length === 0 || length > MAX_SECRET_BYTES) {
    throw new Error("Secret length is invalid");
  }
  return BigInt(ethers.encodeBytes32String(secret));
}

function decodeSecret(value: bigint): string {
  return ethers.decodeBytes32String(ethers.toBeHex(value, 32));
}

describe("SecretVaultSepolia", function () {
  let signers: Signers;
  let secretVaultContract: SecretVault;
  let secretVaultContractAddress: string;
  let step: number;
  let steps: number;

  function progress(message: string) {
    console.log(`${++step}/${steps} ${message}`);
  }

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const SecretVaultDeployment = await deployments.get("SecretVault");
      secretVaultContractAddress = SecretVaultDeployment.address;
      secretVaultContract = await ethers.getContractAt("SecretVault", SecretVaultDeployment.address);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  beforeEach(async () => {
    step = 0;
    steps = 0;
  });

  it("stores and decrypts a secret entry", async function () {
    steps = 9;
    this.timeout(4 * 40000);

    const randomAddress = ethers.Wallet.createRandom().address;
    const secretText = "vault secret";
    const secretValue = encodeSecret(secretText);

    progress(`Encrypting secret input...`);
    const encryptedInput = await fhevm
      .createEncryptedInput(secretVaultContractAddress, signers.alice.address)
      .addAddress(randomAddress)
      .add256(secretValue)
      .encrypt();

    progress(`Call storeSecret()...`);
    let tx = await secretVaultContract
      .connect(signers.alice)
      .storeSecret(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof);
    await tx.wait();

    progress(`Call getSecretCount()...`);
    const count = await secretVaultContract.getSecretCount(signers.alice.address);
    expect(count).to.be.greaterThan(0);

    progress(`Call getSecretEntry()...`);
    const entry = await secretVaultContract.getSecretEntry(signers.alice.address, count - 1n);

    progress(`Decrypting encrypted random address...`);
    const clearKey = await fhevm.userDecryptEuint(
      FhevmType.eaddress,
      entry[0],
      secretVaultContractAddress,
      signers.alice,
    );

    progress(`Decrypting encrypted secret...`);
    const clearSecret = await fhevm.userDecryptEuint(
      FhevmType.euint256,
      entry[1],
      secretVaultContractAddress,
      signers.alice,
    );

    const decryptedAddress = ethers.getAddress(ethers.toBeHex(BigInt(clearKey), 20));
    const decryptedSecret = decodeSecret(BigInt(clearSecret));

    progress(`Decrypted random address: ${decryptedAddress}`);
    progress(`Decrypted secret: ${decryptedSecret}`);

    expect(decryptedAddress).to.eq(randomAddress);
    expect(decryptedSecret).to.eq(secretText);
  });
});
