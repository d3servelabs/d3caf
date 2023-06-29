import { loadFixture, mineUpTo} from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { deployByName } from "../utils/deployUtil";
import { expect } from "chai";
import { D3C2RequestStruct } from "../typechain-types/contracts/D3C2ImplV1";
import { Signer } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// Test for 
describe("D3C2ImplV1", function () {
    // deployFixture 
    async function deployFixture() {
        const [owner, addr1, addr2] = await ethers.getSigners();
        const signers = await ethers.getSigners();
        const { contract:logic } = await deployByName(
            ethers,
            "D3C2ImplV1",
            []
        );


        const { contract: proxy } = await deployByName(
            ethers,
            "TransparentUpgradeableProxy",
            [
                logic.address,
                signers[1].address,
                // Initialization data
                [],
            ]
        );

        await proxy.deployed();
        
        let upgradable = await ethers.getContractAt("D3C2ImplV1", proxy.address);

        await upgradable.initialize(); // initialize the proxy
        // deterministic test wallet as sender
        const testSigner = ethers.Wallet.fromMnemonic(
            "test test test test test test test test test test test junk"
        ).connect(ethers.provider);

        const { contract: factory } = await deployByName(
            ethers,
            "TestingCreate2Deployer",
            [],
            testSigner
        );

        return {
            owner,
            addr1, addr2,
            factory, 
            logic, proxy,
            testSigner,
            upgradable
        };
    };

    it("Should be able to deploy.", async function() {
        const {
            owner,
            logic, proxy
        } = await loadFixture(deployFixture);
    });

    it("Should be able to register a request.", async function() {
        const {
            owner,
            addr1: solver,
            addr2: commissionReceiver,
            factory,
            upgradable,
            testSigner
        } = await loadFixture(deployFixture);
        
        const { contract:testingSum1 } = await deployByName(
            ethers,
            "TestingSum",
            []
        );

        const contractName = "TestingSum";
        const contractArtifact = await ethers.getContractFactory(contractName);
        
        const currentBlock = await ethers.provider.getBlockNumber();

        
        // Send an either to the testSender from owner
        await owner.sendTransaction({
            to: testSigner.address,
            value: ethers.utils.parseEther("2.0"),
        });
        
        const deadline = 10;
        const rewardAmountInWei = ethers.utils.parseEther("1.0");
        const d3c2Request = 
            {
                factory: factory.address,
                bytecodeHash: ethers.utils.keccak256(contractArtifact.bytecode),
                expireAt: ethers.utils.hexlify(currentBlock + deadline),
                rewardType: ethers.constants.Zero,
                rewardAmount: rewardAmountInWei,
                rewardToken: ethers.constants.AddressZero,
                refundReceiver: testSigner.address,
            };
        
        // const initSalt = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
        const initSalt = "0x3f68e79174daf15b50e15833babc8eb7743e730bb9606f922c48e95314c3905c";

        let tx = (await upgradable.connect(testSigner)
            .registerCreate2Request(
                d3c2Request,
                // uint256 init salt
                initSalt,
                {
                    value: rewardAmountInWei,
                }
            ));
        expect(await upgradable.getCommissionReceiver()).to.equal(owner.address);
        await upgradable.setCommissionReceiver(commissionReceiver.address);
        let rc = await tx.wait();
        const event = rc.events?.find((e: any) => e.event === "OnRegisterD3C2Request");
        expect(event).to.not.be.undefined;
        const requestId = event?.args?.requestId;
        expect(requestId).to.not.be.undefined;
        const expectedRequestId = await upgradable.computeRequestId(
            d3c2Request,
        );
        expect(requestId).to.equal(expectedRequestId);
        
        let i = 0;
        let currentBestSalt = await upgradable.getCurrentBestSalt(
            requestId,
        );
        expect(currentBestSalt).to.not.be.undefined;
        expect(currentBestSalt).to.equal(
            initSalt,
        );
        let savedFactory = await upgradable.getFactory(
            requestId,
        );
        expect(savedFactory).to.not.be.undefined;
        expect(savedFactory).to.equal(d3c2Request.factory);
        let bytecodeHash = await upgradable.getBytecodeHash(
            requestId,
        );
        expect(bytecodeHash).to.not.be.undefined;
        expect(bytecodeHash).to.equal(
            ethers.utils.keccak256(contractArtifact.bytecode),
        );

        let currentBestSourceSalt;
        let currentBestAddress = ethers.utils.getCreate2Address
        (
            d3c2Request.factory,
            currentBestSalt,
            d3c2Request.bytecodeHash,
        );
        
        expect(currentBestAddress).to.not.be.undefined;
        const computedAddress = await upgradable.computeAddress(
            requestId,
            currentBestSalt,
        );

        expect(currentBestAddress).to.equal(computedAddress);

        while (true) {
            const newSourceSalt = 
                ethers.utils.hexZeroPad(ethers.BigNumber.from(i).toHexString(), 32);
            const newSalt = await upgradable.computeSalt(
                solver.address,
                newSourceSalt,
            );

            const newAddress = ethers.utils.getCreate2Address
                (
                    d3c2Request.factory,
                    newSalt,
                    bytecodeHash,
                );
            // if newAddress is 16 times smaller or equal to currentBestAddress
            if (ethers.BigNumber.from(newAddress)
                .lte(ethers.BigNumber.from(currentBestAddress).div(16))) {
                currentBestAddress = newAddress;
                currentBestSalt = newSalt;
                currentBestSourceSalt = newSourceSalt;
                break;
            } else {
                // console.log(`${i} newAddress: `, newAddress, "current best: ", currentBestAddress);
            }
            i++;
        }

        const oldCommissionReceiverBalance = await ethers.provider.getBalance(commissionReceiver.address);
        let tx1 = await upgradable.connect(testSigner).registerResponse(
            requestId,
            currentBestSalt,
        );

        let rc1 = await tx1.wait();
        const event1 = rc1.events?.find((e: any) => e.event === "OnNewSalt");
        expect(event1).to.not.be.undefined;
        
        mineUpTo(ethers.BigNumber.from(d3c2Request.expireAt).add(1).toNumber());
        let oldBalance = await ethers.provider.getBalance(solver.address);

        let tx2 = await upgradable.connect(testSigner).claimReward(
            requestId,
            solver.address,
            currentBestSourceSalt,
        );
        let rc2 = await tx2.wait();
        const event2 = rc2.events?.find((e: any) => e.event === "OnClaimD3C2Reward");
        expect(event2).to.not.be.undefined;
        // check that reward ethers are transfered to solver
        const newBalance = await ethers.provider.getBalance(solver.address);
        expect(newBalance).to.not.be.undefined;
        const commissionRateBasisPoint =
            await upgradable.getComissionRateBasisPoints();
        expect(commissionRateBasisPoint).to.equal(500);
        const newCommissionReceiverBalance = await ethers.provider.getBalance(commissionReceiver.address);
        const expectedCommission = d3c2Request.rewardAmount.mul(commissionRateBasisPoint).div(10000);
        expect(newCommissionReceiverBalance.sub(oldCommissionReceiverBalance)).to.equal(expectedCommission);
        expect(newBalance.sub(oldBalance)).to.equal(
            d3c2Request.rewardAmount.mul(
                ethers.BigNumber.from(10000).sub(commissionRateBasisPoint)).div(10000)
            );
        
        let tx3 = await factory.connect(testSigner).deploy(
            currentBestSalt,
            contractArtifact.bytecode
        );
        
        let rc3 = await tx3.wait();
        const event3 = rc3.events?.find((e: any) => e.event === "OnDeploy");
        expect(event3).to.not.be.undefined;
        const deployedAddress = event3?.args?.addr;
        expect(deployedAddress).to.not.be.undefined;
        expect(deployedAddress).to.equal(currentBestAddress);
        console.log("deployedAddress: ", deployedAddress);
        console.log("currentBestSalt: ", currentBestSalt);
    });
});