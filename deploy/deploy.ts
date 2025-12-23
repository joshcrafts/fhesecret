import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedSecretVault = await deploy("SecretVault", {
    from: deployer,
    log: true,
  });

  console.log(`SecretVault contract: `, deployedSecretVault.address);
};
export default func;
func.id = "deploy_secretVault";
func.tags = ["SecretVault"];
