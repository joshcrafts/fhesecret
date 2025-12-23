import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { SecretVault, SecretVault__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const MAX_SECRET_BYTES = 31;

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("SecretVault")) as SecretVault__factory;
  const secretVaultContract = (await factory.deploy()) as SecretVault;
  const secretVaultContractAddress = await secretVaultContract.getAddress();

  return { secretVaultContract, secretVaultContractAddress };
}

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

describe("SecretVault", function () {
  let signers: Signers;
  let secretVaultContract: SecretVault;
  let secretVaultContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ secretVaultContract, secretVaultContractAddress } = await deployFixture());
  });

  it("stores and decrypts an encrypted secret entry", async function () {
    const randomAddress = ethers.Wallet.createRandom().address;
    const secretText = "vault secret";
    const secretValue = encodeSecret(secretText);

    const encryptedInput = await fhevm
      .createEncryptedInput(secretVaultContractAddress, signers.alice.address)
      .addAddress(randomAddress)
      .add256(secretValue)
      .encrypt();

    const tx = await secretVaultContract
      .connect(signers.alice)
      .storeSecret(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof);
    await tx.wait();

    const count = await secretVaultContract.getSecretCount(signers.alice.address);
    expect(count).to.eq(1);

    const entry = await secretVaultContract.getSecretEntry(signers.alice.address, 0);

    const clearKey = await fhevm.userDecryptEuint(
      FhevmType.eaddress,
      entry[0],
      secretVaultContractAddress,
      signers.alice,
    );
    const clearSecret = await fhevm.userDecryptEuint(
      FhevmType.euint256,
      entry[1],
      secretVaultContractAddress,
      signers.alice,
    );

    const decryptedAddress = ethers.getAddress(ethers.toBeHex(BigInt(clearKey), 20));
    const decryptedSecret = decodeSecret(BigInt(clearSecret));

    expect(decryptedAddress).to.eq(randomAddress);
    expect(decryptedSecret).to.eq(secretText);
  });
});
