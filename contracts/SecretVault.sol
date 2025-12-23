// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, eaddress, euint256, externalEaddress, externalEuint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SecretVault
/// @notice Stores encrypted secrets tied to an encrypted random address
contract SecretVault is ZamaEthereumConfig {
    struct SecretEntry {
        eaddress encryptedKey;
        euint256 encryptedSecret;
        uint256 createdAt;
    }

    mapping(address => SecretEntry[]) private entries;

    event SecretStored(address indexed owner, uint256 indexed index, uint256 timestamp);

    /// @notice Store an encrypted random address and an encrypted secret
    /// @param encryptedKey The encrypted random address
    /// @param encryptedSecret The encrypted secret as a 32-byte value
    /// @param inputProof Proof for the encrypted inputs
    function storeSecret(
        externalEaddress encryptedKey,
        externalEuint256 encryptedSecret,
        bytes calldata inputProof
    ) external {
        eaddress key = FHE.fromExternal(encryptedKey, inputProof);
        euint256 secret = FHE.fromExternal(encryptedSecret, inputProof);

        entries[msg.sender].push(
            SecretEntry({encryptedKey: key, encryptedSecret: secret, createdAt: block.timestamp})
        );

        uint256 index = entries[msg.sender].length - 1;

        FHE.allowThis(key);
        FHE.allowThis(secret);
        FHE.allow(key, msg.sender);
        FHE.allow(secret, msg.sender);

        emit SecretStored(msg.sender, index, block.timestamp);
    }

    /// @notice Get the number of stored secrets for an owner
    /// @param owner The address whose entries are being queried
    function getSecretCount(address owner) external view returns (uint256) {
        return entries[owner].length;
    }

    /// @notice Get a secret entry by owner and index
    /// @param owner The address whose entry is being queried
    /// @param index The index of the entry
    function getSecretEntry(address owner, uint256 index) external view returns (eaddress, euint256, uint256) {
        SecretEntry storage entry = entries[owner][index];
        return (entry.encryptedKey, entry.encryptedSecret, entry.createdAt);
    }
}
