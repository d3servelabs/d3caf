import { assert } from "console";
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

task("d3caf-mine", "Mine a D3CAFResponse")
    .addParam("d3caf", "The D3CAF contract address")
    .addParam("request", "Request ID")
    .addParam("solver", "Solver address")
    .addFlag("submit", "Should the mined result be submitted?")
    .setAction(async function (taskArguments: TaskArguments, { ethers, run, artifacts }) {
        const requester = (await ethers.getSigners())[0];
        const d3caf = await ethers.getContractAt("D3CAFImplV1", taskArguments.d3caf);
        const request = await d3caf.connect(requester).getCreate2Request(taskArguments.request);
        console.log(`request`, request);

        let currentBestSalt = await d3caf.connect(requester).getCurrentBestSalt(taskArguments.request);
        let currentBestAddress = ethers.utils.getCreate2Address
        (
            request.factory,
            currentBestSalt,
            request.bytecodeHash,
        );
        console.log(`currentBestAddress: `, currentBestAddress);
        let currentBestAddress2 = await d3caf.connect(requester)
            .computeAddress(taskArguments.request, currentBestSalt);
        console.log(`currentBestAddress2: `, currentBestAddress2);

        assert(currentBestAddress === currentBestAddress2, "currentBestAddress != currentBestAddress2");

        console.log(`initBestSalt: `, currentBestSalt);
        console.log(`initBestAddress: `, currentBestAddress);
        let i = 1;
        let currentBestSourceSalt = ethers.utils.hexZeroPad(ethers.BigNumber.from(i).toHexString(), 32);
        
        while (true) {
            const newSourceSalt = 
                ethers.utils.hexZeroPad(ethers.BigNumber.from(i).toHexString(), 32);

            const newSalt = // keccak256(abi.encodePacked(rewardReceiver, sourceSalt));
                ethers.utils.keccak256(ethers.utils.concat([taskArguments.solver, newSourceSalt]));
            console.log(`newSalt: `, newSalt);

  
            const newAddress = ethers.utils.getCreate2Address
                (
                    request.factory,
                    newSalt,
                    request.bytecodeHash,
                );
            // if newAddress is 16 times smaller or equal to currentBestAddress
            if (ethers.BigNumber.from(newAddress)
                .lte(ethers.BigNumber.from(currentBestAddress).div(2**4))) {
                currentBestAddress = newAddress;
                currentBestSalt = newSalt;
                currentBestSourceSalt = newSourceSalt;
                break;
            } else {
                console.log(`${i} newAddress: `, newAddress, "current best: ", currentBestAddress);
            }
            i++;
        }
        
        console.log(`currentBestSalt: `, currentBestSalt);
        console.log(`currentBestSourceSalt: `, currentBestSourceSalt);
        console.log(`currentBestAddress: `, currentBestAddress);
        const currentBestSalt2 = await d3caf.computeSalt(
            taskArguments.solver,
            currentBestSourceSalt,
        );
        assert(currentBestSalt === currentBestSalt2, "currentBestSalt != currentBestSalt2");
        console.log(`currentBestSalt2: `, currentBestSalt2);
        
        if (taskArguments.submit) {
            const tx = await d3caf.connect(requester).registerResponse(
                taskArguments.request,
                currentBestSalt,
                {gasLimit: 1000000}
            );
            console.log(`Submitting solution... at ${tx.hash}`);
            const rc = await tx.wait();
            const event = rc.events?.find((e: any) => e.event === "OnNewSalt");
            const salt = event?.args?.salt;
            console.log(`Solution submitted: ${salt}`);
        }
        
    });


task("d3caf-claim", "Claim reward")
.addParam("d3caf", "The D3CAF contract address")
.addParam("request", "Request ID")
.addParam("solver", "Solver address")
.addParam("sourceSalt", "source salt to claim")
.setAction(async function (taskArguments: TaskArguments, { ethers, run, artifacts }) {
    const requester = (await ethers.getSigners())[0];
    const d3caf = await ethers.getContractAt("D3CAFImplV1", taskArguments.d3caf);
    const request = await d3caf.connect(requester).getCreate2Request(taskArguments.request);
    console.log(`request`, request);
    const tx = await d3caf.connect(requester).claimReward(
        taskArguments.request, 
        taskArguments.solver, 
        taskArguments.sourceSalt,
        {gasLimit: 1000000}
    );
    console.log(`Submitting solution... at ${tx.hash}`);
    const rc = await tx.wait();
    const event = rc.events?.find((e: any) => e.event === "OnClaimD3CAFReward");
    const requestId = event?.args?.requestId;
    const rewardAmount = event?.args?.rewardAmount;
    const calculatedAddress = event?.args?.calculatedAddress;

    console.log(`Claimed requestId = ${requestId} for rewardAmount = ${rewardAmount} to ${calculatedAddress}`);

});

