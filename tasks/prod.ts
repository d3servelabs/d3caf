import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { deployByName } from "../utils/deployUtil";
const WAIT_FOR_BLOCK = 3;
task("d3ns-deploy-d3caf", "Destroy the D3CAFV1 contract.")
    .setAction(async function (taskArguments: TaskArguments, { ethers, run }) {
        const logicContractName = "D3CAFImplV1";
        const network = await ethers.provider.getNetwork();
        console.log("network", network);
        const signers = await ethers.getSigners();
        const { contract: logic } = await deployByName(
            ethers,
            logicContractName,
            []
        );

        await logic.deployed();
        
        let tx = logic.deployTransaction;
        
        for (let i = 0; i < WAIT_FOR_BLOCK; i++) {
            console.log(`Block ${i}...`);
            await tx.wait(i);
        }

        console.log(`Done waiting for the confirmation for contract ${logicContractName} at ${logic.address}`);
        await run("verify:verify", {
            address: logic.address,
        }).catch(e => console.log(`Failure ${e} when verifying ${logicContractName} at ${logic.address}`));
        console.log(`Done verifying ${logicContractName} at ${logic.address}`);
        console.log(`Deploy proxy with admin ${taskArguments.admin}...`);

        const { contract: proxyAdmin } = await deployByName(
            ethers,
            "ProxyAdmin",
            []
        );

        await proxyAdmin.deployed();
        let tx3 = proxyAdmin.deployTransaction;

        for (let i = 0; i < WAIT_FOR_BLOCK; i++) {
            console.log(`Block ${i}...`);
            await tx3.wait(i);
        }

        console.log(`Done waiting for the confirmation for contract proxyAdmin at ${proxyAdmin.address}`);
        await run("verify:verify", {
            address: proxyAdmin.address,
        }).catch(e => console.log(`Failure ${e} when verifying proxyAdmin at ${proxyAdmin.address}`));
        console.log(`Done verifying proxyAdmin at ${proxyAdmin.address}`);

        const { contract: d3cafProxy } = await deployByName(
            ethers,
            "TransparentUpgradeableProxy",
            [
                logic.address,
                proxyAdmin.address,
                // Initialization data
                [],
            ]
        );

        await d3cafProxy.deployed();
        let tx2 = d3cafProxy.deployTransaction;
        // attach contract to UnsafelyDestroyable
        const d3caf = await ethers.getContractAt(logicContractName, d3cafProxy.address);
        await d3caf.initialize();

        for (let i = 0; i < WAIT_FOR_BLOCK; i++) {
            console.log(`Block ${i}...`);
            await tx2.wait(i);
        }

        console.log(`Done waiting for the confirmation for contract TransparentUpgradeableProxy at ${d3cafProxy.address}`);
        await run("verify:verify", {
            address: d3cafProxy.address,
            constructorArguments: [
                logic.address,
                proxyAdmin.address,
                // Initialization data
                [],
            ],
        }).catch(e => console.log(`Failure ${e} when verifying TransparentUpgradeableProxy at ${d3cafProxy.address}`));
        console.log(`Done verifying TransparentUpgradeableProxy at ${d3cafProxy.address}`);
    });

task("d3ns-verify-proxy", "Destroy the D3CAFV1 contract.")
    .addParam("proxy", "The proxy address")
    .addParam("admin", "The admin address")
    .addParam("logic", "The logic address")
    .setAction(async function (taskArguments: TaskArguments, { ethers, run }) {
        await run("verify:verify", {
            address: taskArguments.proxy,
            constructorArguments: [
                taskArguments.logic,
                taskArguments.admin,
                // Initialization data
                [],
            ],
            // contract: "contracts/proxy/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy"
        }).catch(e => console.log(`Failure ${e} when verifying TransparentUpgradeableProxy at ${taskArguments.proxy}`));
        console.log(`Done verifying TransparentUpgradeableProxy at ${taskArguments.proxy}`);
    });