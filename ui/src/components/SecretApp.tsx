import { useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import {
  Contract,
  Wallet,
  decodeBytes32String,
  encodeBytes32String,
  getAddress,
  toBeHex,
} from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import '../styles/SecretApp.css';

const MAX_SECRET_BYTES = 31;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function normalizeBigInt(value: string | bigint | number) {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  if (value.startsWith('0x')) {
    return BigInt(value);
  }
  return BigInt(value);
}

function decodeSecretValue(value: string | bigint | number) {
  const secretHex = toBeHex(normalizeBigInt(value), 32);
  try {
    return decodeBytes32String(secretHex);
  } catch (error) {
    return secretHex;
  }
}

function decodeAddressValue(value: string | bigint | number) {
  const addressHex = toBeHex(normalizeBigInt(value), 20);
  return getAddress(addressHex);
}

export function SecretApp() {
  const { address } = useAccount();
  const { instance, isLoading: isZamaLoading, error: zamaError } = useZamaInstance();
  const signer = useEthersSigner();

  const [secretInput, setSecretInput] = useState('');
  const [randomAddress, setRandomAddress] = useState('');
  const [submitStatus, setSubmitStatus] = useState('');
  const [decryptingIndex, setDecryptingIndex] = useState<number | null>(null);
  const [decryptedEntries, setDecryptedEntries] = useState<Record<number, { keyAddress: string; secret: string }>>({});
  const [formError, setFormError] = useState('');

  const isContractConfigured = CONTRACT_ADDRESS !== ZERO_ADDRESS;
  const secretBytes = useMemo(() => getUtf8ByteLength(secretInput), [secretInput]);
  const isSecretValid = secretBytes > 0 && secretBytes <= MAX_SECRET_BYTES;

  const { data: secretCountData, refetch: refetchSecretCount } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getSecretCount',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && isContractConfigured,
    },
  });

  const secretCount = Number(secretCountData ?? 0);

  const entryCalls = useMemo(() => {
    if (!address || !isContractConfigured || secretCount === 0) {
      return [];
    }
    return Array.from({ length: secretCount }, (_, index) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getSecretEntry',
      args: [address, BigInt(index)],
    }));
  }, [address, isContractConfigured, secretCount]);

  const { data: entriesData, refetch: refetchEntries } = useReadContracts({
    contracts: entryCalls,
    query: {
      enabled: entryCalls.length > 0,
    },
  });

  const entries = useMemo(() => {
    if (!entriesData) {
      return [] as Array<{
        index: number;
        encryptedKey: string;
        encryptedSecret: string;
        createdAt: number;
      }>;
    }

    return entriesData
      .map((entry, index) => {
        const result = entry.result as readonly [string, string, bigint] | undefined;
        if (!result) {
          return null;
        }

        return {
          index,
          encryptedKey: result[0],
          encryptedSecret: result[1],
          createdAt: Number(result[2]),
        };
      })
      .filter((entry): entry is { index: number; encryptedKey: string; encryptedSecret: string; createdAt: number } =>
        Boolean(entry),
      );
  }, [entriesData]);

  const handleGenerateAddress = () => {
    const generated = Wallet.createRandom().address;
    setRandomAddress(generated);
    setFormError('');
  };

  const handleStoreSecret = async () => {
    if (!address) {
      setFormError('Connect your wallet to store secrets.');
      return;
    }
    if (!isContractConfigured) {
      setFormError('Set the deployed contract address before sending transactions.');
      return;
    }
    if (!instance) {
      setFormError('Encryption service is not ready yet.');
      return;
    }
    if (!randomAddress) {
      setFormError('Generate a random address before storing a secret.');
      return;
    }
    if (!isSecretValid) {
      setFormError(`Secret must be 1 to ${MAX_SECRET_BYTES} bytes.`);
      return;
    }

    const resolvedSigner = await signer;
    if (!resolvedSigner) {
      setFormError('Wallet signer is not available.');
      return;
    }

    setFormError('');
    setSubmitStatus('Encrypting and sending transaction...');

    try {
      const encodedSecret = encodeBytes32String(secretInput);
      const secretValue = BigInt(encodedSecret);

      const encryptedInput = await instance
        .createEncryptedInput(CONTRACT_ADDRESS, address)
        .addAddress(getAddress(randomAddress))
        .add256(secretValue)
        .encrypt();

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, resolvedSigner);
      const tx = await contract.storeSecret(
        encryptedInput.handles[0],
        encryptedInput.handles[1],
        encryptedInput.inputProof,
      );

      setSubmitStatus('Waiting for confirmation...');
      await tx.wait();

      setSubmitStatus('Secret stored successfully.');
      setSecretInput('');
      setRandomAddress('');
      await refetchSecretCount();
      await refetchEntries();
    } catch (error) {
      console.error('Failed to store secret', error);
      setSubmitStatus('');
      setFormError('Transaction failed. Check the console for details.');
    }
  };

  const handleDecryptEntry = async (entry: { index: number; encryptedKey: string; encryptedSecret: string }) => {
    if (!instance || !address) {
      setFormError('Encryption service is not ready yet.');
      return;
    }

    const resolvedSigner = await signer;
    if (!resolvedSigner) {
      setFormError('Wallet signer is not available.');
      return;
    }

    setDecryptingIndex(entry.index);
    setFormError('');

    try {
      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const contractAddresses = [CONTRACT_ADDRESS];

      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays,
      );

      const signature = await resolvedSigner.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message,
      );

      const decrypted = await instance.userDecrypt(
        [
          { handle: entry.encryptedKey, contractAddress: CONTRACT_ADDRESS },
          { handle: entry.encryptedSecret, contractAddress: CONTRACT_ADDRESS },
        ],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      const decryptedKeyValue = decrypted[entry.encryptedKey as string];
      const decryptedSecretValue = decrypted[entry.encryptedSecret as string];

      if (decryptedKeyValue === undefined || decryptedSecretValue === undefined) {
        throw new Error('Decryption response is missing expected values.');
      }

      const decryptedAddress = decodeAddressValue(decryptedKeyValue);
      const decryptedSecret = decodeSecretValue(decryptedSecretValue);

      setDecryptedEntries((previous) => ({
        ...previous,
        [entry.index]: {
          keyAddress: decryptedAddress,
          secret: decryptedSecret,
        },
      }));
    } catch (error) {
      console.error('Failed to decrypt entry', error);
      setFormError('Failed to decrypt entry. Check console for details.');
    } finally {
      setDecryptingIndex(null);
    }
  };

  return (
    <div className="vault-shell">
      <header className="vault-header">
        <div className="vault-brand">
          <span className="vault-kicker">FHE Secret Vault</span>
          <h1>Encrypted secrets with a random address key.</h1>
          <p>
            Generate a fresh address, encrypt it with Zama, and store your secret string on-chain.
            Decrypt the address first, then unlock every saved entry.
          </p>
        </div>
        <div className="vault-connect">
          <ConnectButton />
        </div>
      </header>

      <div className="vault-grid">
        <section className="vault-card">
          <div className="card-header">
            <h2>Create a secret</h2>
            <p>Secret strings are stored as encrypted 32-byte values.</p>
          </div>

          <div className="field-group">
            <label htmlFor="secretInput">Secret string</label>
            <textarea
              id="secretInput"
              value={secretInput}
              onChange={(event) => setSecretInput(event.target.value)}
              placeholder="Enter a short secret (max 31 bytes)"
              rows={3}
            />
            <div className={`helper-text ${isSecretValid ? '' : 'warning'}`}>
              {secretBytes}/{MAX_SECRET_BYTES} bytes
            </div>
          </div>

          <div className="field-group">
            <label>Random address A</label>
            <div className="address-row">
              <div className="address-pill">
                {randomAddress || 'Generate a fresh address to encrypt'}
              </div>
              <button type="button" className="secondary" onClick={handleGenerateAddress}>
                Generate address
              </button>
            </div>
          </div>

          {formError ? <p className="form-error">{formError}</p> : null}
          {zamaError ? <p className="form-error">{zamaError}</p> : null}

          <button
            type="button"
            className="primary"
            onClick={handleStoreSecret}
            disabled={!address || !instance || !randomAddress || !isSecretValid || isZamaLoading}
          >
            {isZamaLoading ? 'Loading encryption...' : 'Encrypt and store'}
          </button>

          {submitStatus ? <p className="status-text">{submitStatus}</p> : null}
          {!isContractConfigured ? (
            <p className="status-text warning">Set the deployed contract address to enable writes.</p>
          ) : null}
        </section>

        <section className="vault-card">
          <div className="card-header">
            <h2>Your stored secrets</h2>
            <p>Decrypt each entry to reveal the random address and secret string.</p>
          </div>

          {!address ? (
            <div className="empty-state">
              <p>Connect your wallet to view stored entries.</p>
            </div>
          ) : null}

          {address && secretCount === 0 ? (
            <div className="empty-state">
              <p>No entries found yet. Create one to get started.</p>
            </div>
          ) : null}

          {entries.map((entry) => {
            const decrypted = decryptedEntries[entry.index];
            const createdAt = entry.createdAt
              ? new Date(entry.createdAt * 1000).toLocaleString()
              : 'Pending timestamp';

            return (
              <div key={entry.index} className="entry-card">
                <div className="entry-meta">
                  <div>
                    <span className="meta-label">Entry</span>
                    <span className="meta-value">#{entry.index + 1}</span>
                  </div>
                  <div>
                    <span className="meta-label">Created</span>
                    <span className="meta-value">{createdAt}</span>
                  </div>
                </div>

                <div className="entry-handles">
                  <div>
                    <span className="meta-label">Encrypted key</span>
                    <span className="mono">{entry.encryptedKey.slice(0, 18)}...</span>
                  </div>
                  <div>
                    <span className="meta-label">Encrypted secret</span>
                    <span className="mono">{entry.encryptedSecret.slice(0, 18)}...</span>
                  </div>
                </div>

                {decrypted ? (
                  <div className="entry-decrypted">
                    <div>
                      <span className="meta-label">Decrypted address</span>
                      <span className="mono">{decrypted.keyAddress}</span>
                    </div>
                    <div>
                      <span className="meta-label">Decrypted secret</span>
                      <span className="mono">{decrypted.secret}</span>
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleDecryptEntry(entry)}
                  disabled={!instance || !address || decryptingIndex === entry.index}
                >
                  {decryptingIndex === entry.index ? 'Decrypting...' : 'Decrypt entry'}
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
