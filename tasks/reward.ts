import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
const WAIT_FOR_BLOCK = 3;
const NICK_CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const TEST_CREATE2_FACTORY = "0x660CA455230Cddf3A28e6316F369064369A4494f";

task("d3caf-register", "Register a D3CAFRequest")
    .addParam("d3caf", "The D3CAF contract address")
    .addOptionalParam("factory", "Factory address", TEST_CREATE2_FACTORY)
    .addParam("bytecode", "Bytecode to deploy")
    .setAction(async function (taskArguments: TaskArguments, { ethers, run, artifacts }) {
        const requester = (await ethers.getSigners())[0];
        const currentBlock = await ethers.provider.getBlockNumber();

        console.log(`Current block ${currentBlock}`);
        const deadline = 300 /* 10min */ / 12 /* seconds per block */;
        console.log(`deadline ${deadline}`);
        const initSourceSalt = ethers.utils.randomBytes(32);
        const initSalt = // keccak256(abi.encodePacked(rewardReceiver, sourceSalt));
            ethers.utils.keccak256(ethers.utils.concat([requester.address, initSourceSalt]));
        
        const rewardAmountInWei = ethers.utils.parseEther("0.01");
        const d3cafRequest = 
        {
            factory: taskArguments.factory,
            bytecodeHash: ethers.utils.keccak256(taskArguments.bytecode),
            expireAt: ethers.utils.hexlify(currentBlock + deadline),
            initSalt: initSalt,
            rewardType: ethers.constants.Zero,
            rewardAmount: rewardAmountInWei,
            rewardToken: ethers.constants.AddressZero,
            refundReceiver: requester.address,
        };
        const d3caf = await ethers.getContractAt("D3CAFImplV1", taskArguments.d3caf);
        let tx = await d3caf.registerCreate2Request(d3cafRequest, {value: rewardAmountInWei});
        console.log(`Registering request... at ${tx.hash}`);
        let rc = await tx.wait();
        const event = rc.events?.find((e: any) => e.event === "OnRegisterD3CAFRequest");
        const requestId = event?.args?.requestId;
        console.log(`Request ${requestId} registered`);
    });

// task("d3caf-mine", "Mine a D3CAFResponse")
//     .addParam("d3caf", "The D3CAF contract address")
//     .addParam("request", "Request ID")
//     .setAction(async function (taskArguments: TaskArguments, { ethers, run, artifacts }) {
//         const d3caf = await ethers.getContractAt("D3CAFImplV1", taskArguments.d3caf);
//         console.log(`D3CAF at ${d3caf.address}`);
//         console.log(`taskArguments.request ${taskArguments.request}`);
//         // const request = await d3caf.getCreate2Request(taskArguments.request);
//         const owner = await  d3caf.owner();
//         console.log(`owner ${owner}`);
//         // console.log(`request`, request);
//     });
