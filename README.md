# FHE Secret Vault

FHE Secret Vault is a full-stack example that lets users store short secrets on-chain without revealing the plaintext.
It generates a random address A on the client, encrypts A and the secret using Zama FHE, and writes both encrypted
values to a Solidity smart contract. When users want to read their secrets, the client decrypts address A and the
stored secret values using the Zama relayer flow and a wallet signature.

This repository contains:
- A Solidity contract that stores encrypted entries per owner.
- Hardhat tasks and deployment scripts for local and Sepolia use.
- A React + Vite frontend that encrypts, stores, and decrypts secrets.

## What Problem This Solves

On-chain data is public by default. If you store a secret on-chain in plaintext, anyone can read it forever. Traditional
approaches either keep secrets off-chain (losing the benefits of composability and verifiability) or require a trusted
server to keep data private. This project uses Fully Homomorphic Encryption (FHE) to keep secrets confidential while
still enabling on-chain storage and per-user retrieval.

## Key Advantages

- On-chain storage without plaintext leakage.
- End-to-end encryption flow driven by the user wallet.
- No backend server required for secret management.
- Decryption requires a user signature and a Zama relayer flow.
- Clear separation of read (viem/wagmi) and write (ethers) paths.

## Core Workflow

1. User connects a wallet in the frontend.
2. Frontend generates a random EVM address A.
3. Frontend encrypts A and the secret with Zama FHE.
4. Encrypted values are stored on-chain in the `SecretVault` contract.
5. Frontend reads encrypted entries via `getSecretEntry`.
6. User signs a decrypt request; relayer returns decrypted values.

## Architecture Overview

Smart contract:
- Stores encrypted address + encrypted secret + timestamp in a per-owner list.
- Exposes read-only methods for entry count and entry data.

Frontend:
- React + Vite UI in `ui/`.
- Reads on-chain data via wagmi (viem under the hood).
- Writes on-chain data via ethers v6.
- Uses Zama Relayer SDK to encrypt and decrypt.

Tooling:
- Hardhat + hardhat-deploy for compile, deploy, and tasks.
- Zama FHEVM plugin for encrypted inputs.

## Contract Details

Contract: `contracts/SecretVault.sol`

Storage model:
- `mapping(address => SecretEntry[]) private entries;`
- Each `SecretEntry` contains:
  - `encryptedKey` (eaddress): encrypted random address A.
  - `encryptedSecret` (euint256): encrypted secret value.
  - `createdAt` (uint256): timestamp.

Public interface:
- `storeSecret(externalEaddress, externalEuint256, bytes)` writes an entry.
- `getSecretCount(address owner)` returns entry count for `owner`.
- `getSecretEntry(address owner, uint256 index)` returns encrypted values and timestamp.

Events:
- `SecretStored(owner, index, timestamp)` signals new entries.

Constraints:
- Secrets are stored as 32-byte values (31 bytes usable for UTF-8 strings).
- View functions do not depend on `msg.sender`.

## Frontend Details

UI entry point: `ui/src/components/SecretApp.tsx`

Behavior:
- Generates a random address with `ethers.Wallet.createRandom()`.
- Encrypts address and secret via Zama Relayer SDK.
- Sends `storeSecret` using ethers v6.
- Reads `getSecretCount` and `getSecretEntry` via wagmi/viem.
- Decrypts entries with a user-signed EIP-712 message.

Important config files:
- `ui/src/config/contracts.ts` holds the deployed address and ABI.
- `ui/src/config/wagmi.ts` holds the WalletConnect project ID and network.

No frontend environment variables are used. Update the config files directly.

## Data Privacy Model

What is public:
- The owner address for each entry (mapping key and event).
- Entry count, timestamps, and encrypted handles.

What remains confidential:
- The random address A (encrypted).
- The secret value (encrypted).

Only the wallet that owns the entry and has the decryption permissions can recover plaintext values.

## Limitations

- Secrets are limited to 31 UTF-8 bytes per entry.
- No deletion or rotation flow is implemented.
- No multi-recipient sharing or access control beyond the owner.
- Encrypted values are stored as opaque handles, so you cannot search by secret content.

## Prerequisites

- Node.js 20+
- npm
- A wallet and Sepolia test ETH

## Installation

Install root dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
cd ui
npm install
```

## Configuration

Hardhat environment variables (root `.env`):

```
PRIVATE_KEY=your_private_key
INFURA_API_KEY=your_infura_project_id
ETHERSCAN_API_KEY=your_etherscan_key
```

Frontend config updates:

1. Deploy the contract (see Deployment below) to create `deployments/sepolia/SecretVault.json`.
2. Copy the deployed address and ABI into `ui/src/config/contracts.ts`.
3. Set your WalletConnect Project ID in `ui/src/config/wagmi.ts`.

## Compile and Test

```bash
npm run compile
npm run test
```

## Local Development

Start a local node:

```bash
npx hardhat node
```

Deploy locally:

```bash
npx hardhat deploy --network localhost
```

Start the UI (from `ui/`):

```bash
npm run dev
```

## Sepolia Deployment

Deploy to Sepolia:

```bash
npx hardhat deploy --network sepolia
```

Verify on Etherscan (optional):

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## Hardhat Tasks

Print contract address:

```bash
npx hardhat --network sepolia task:address
```

Store a secret:

```bash
npx hardhat --network sepolia task:store-secret --secret "vault secret"
```

Decrypt a secret by index:

```bash
npx hardhat --network sepolia task:decrypt-secret --index 0
```

## Project Structure

```
.
├── contracts/          # Solidity contracts
├── deploy/             # Deployment scripts
├── tasks/              # Hardhat tasks
├── test/               # Contract tests
├── ui/                 # React + Vite frontend
└── hardhat.config.ts   # Hardhat configuration
```

## Roadmap

- Support secret rotation and optional expiration.
- Add sharing with explicit allowlists and revocable access.
- Add batch encryption and batching for gas efficiency.
- Improve UI status tracking and history filters.
- Add export/import for decrypted entries on the client.
- Extend multi-network support beyond Sepolia.

## License

BSD-3-Clause-Clear. See `LICENSE`.
