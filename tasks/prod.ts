import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { deployByName } from "../utils/deployUtil";

task("d3ns-deploy-D3CAF", "Destroy the D3CAFV1 contract.")
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
        
        for (let i = 0; i < 6; i++) {
            console.log(`Block ${i}...`);
            await tx.wait(i);
        }

        console.log(`Done waiting for the confirmation for contract ${logicContractName} at ${logic.address}`);
        await run("verify:verify", {
            address: logic.address,
        }).catch(e => console.log(`Failure ${e} when verifying ${logicContractName} at ${logic.address}`));
        console.log(`Done verifying ${logicContractName} at ${logic.address}`);

        const { contract: d3cr2Proxy } = await deployByName(
            ethers,
            "TransparentUpgradeableProxy",
            [
                logic.address,
                signers[1].address, // TODO update to configurable admin address.
                // Initialization data
                [],
            ]
        );

        await d3cr2Proxy.deployed();
        let tx2 = d3cr2Proxy.deployTransaction;
        // attach contract to UnsafelyDestroyable
        const d3cr2 = await ethers.getContractAt(logicContractName, d3cr2Proxy.address);
        await d3cr2.initialize();

        for (let i = 0; i < 6; i++) {
            console.log(`Block ${i}...`);
            await tx2.wait(i);
        }

        console.log(`Done waiting for the confirmation for contract TransparentUpgradeableProxy at ${d3cr2Proxy.address}`);
        await run("verify:verify", {
            address: d3cr2Proxy.address,
        }).catch(e => console.log(`Failure ${e} when verifying TransparentUpgradeableProxy at ${d3cr2Proxy.address}`));
        console.log(`Done verifying TransparentUpgradeableProxy at ${d3cr2Proxy.address}`);

    });