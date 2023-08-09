import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { deployByName } from "../utils/deployUtil";
const WAIT_FOR_BLOCK = 6;
task("d3caf-deploy-premine", "Deploy the premine code")
    .setAction(async function (taskArguments: TaskArguments, { ethers, run }) {
        const logicContractName = "Premine";
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
    
    });

task("d3caf-premine-call", "Call the premine code")
    .setAction(async function (taskArguments: TaskArguments, { ethers, run }) {
        const logicContractName = "Premine";
        const contractAddress = "0xCa566D67ac22DC0976B93bB50e913c09075dB0Ed";
        console.log("Random bytes32", ethers.utils.hexlify(ethers.utils.randomBytes(32)));
        // const logic = await ethers.getContractAt(logicContractName, contractAddress);
        // const signers = await ethers.getSigners();
        // await logic.connect(signers[0]).deploy(ethers.utils.hexZeroPad("0x00", 32), "0x209992056d9e776f3beA884534b878b27B98cF15");
        // console.log(`Done calling ${logicContractName} at ${logic.address}`);
    });
