import { loadFixture, mineUpTo} from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { deployByName } from "../utils/deployUtil";
import { expect } from "chai";
import { D3CAFRequestStruct } from "../typechain-types/contracts/D3CAFImplV1";
import { Signer } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// Test for 
describe("D3CAFImplV1", function () {
    // deployFixture 
    async function deployFixture() {
        const [owner, addr1, addr2] = await ethers.getSigners();
        const signers = await ethers.getSigners();
        const { contract:logic } = await deployByName(
            ethers,
            "D3CAFImplV1",
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
        
        let upgradable = await ethers.getContractAt("D3CAFImplV1", proxy.address);

        await upgradable.initialize(); // initialize the proxy
        // deterministic test wallet as sender
        const deterministicTestSigner = ethers.Wallet.fromMnemonic(
            "test test test test test test test test test test test junk"
        ).connect(ethers.provider);

        const { contract: deterministicFactory } = await deployByName(
            ethers,
            "TestingCreate2Deployer",
            [],
            deterministicTestSigner
        );
        const testSumContractArtifact = await ethers.getContractFactory("TestingSum");
        const bytecodeToDeploy = testSumContractArtifact.bytecode;
        return {
            owner,
            addr1, addr2, addr3: signers[2],
            addr4: signers[3],
            deterministicFactory, 
            logic, proxy,
            deterministicTestSigner,
            upgradable,
            bytecodeToDeploy,
            testSumContractArtifact
        };
    };

    it("Should be able to deploy.", async function() {
        const {
            owner,
            logic, proxy
        } = await loadFixture(deployFixture);
    });

    describe("E2E", function() {
        it("Should be able to register a request.", async function() {
            const {
                owner,
                addr1: solver,
                addr2: commissionReceiver,
                addr3: requester,
                addr4: refundReceiver,
                deterministicFactory,
                upgradable,
                deterministicTestSigner,
                bytecodeToDeploy,
                testSumContractArtifact
            } = await loadFixture(deployFixture);
    
            const currentBlock = await ethers.provider.getBlockNumber();
            
            const deadline = 10;
            const rewardAmountInWei = ethers.utils.parseEther("1.0");

            // const initSalt = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
            const initSalt = "0x3f68e79174daf15b50e15833babc8eb7743e730bb9606f922c48e95314c3905c";
    
            const D3CAFRequest = 
                {
                    factory: deterministicFactory.address,
                    bytecodeHash: ethers.utils.keccak256(bytecodeToDeploy),
                    expireAt: ethers.utils.hexlify(currentBlock + deadline),
                    initSalt: initSalt,
                    rewardType: ethers.constants.Zero,
                    rewardAmount: rewardAmountInWei,
                    rewardToken: ethers.constants.AddressZero,
                    refundReceiver: refundReceiver.address,
                };
            
            let tx = (await upgradable.connect(requester)
                .registerCreate2Request(
                    D3CAFRequest,
                    {
                        value: rewardAmountInWei,
                    }
                ));
            expect(await upgradable.getCommissionReceiver()).to.equal(owner.address);
            await upgradable.setCommissionReceiver(commissionReceiver.address);
            let rc = await tx.wait();
            const event = rc.events?.find((e: any) => e.event === "OnRegisterD3CAFRequest");
            expect(event).to.not.be.undefined;
            const requestId = event?.args?.requestId;
            expect(requestId).to.not.be.undefined;
            const expectedRequestId = await upgradable.computeRequestId(
                D3CAFRequest,
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
            expect(savedFactory).to.equal(D3CAFRequest.factory);
            let bytecodeHash = await upgradable.getBytecodeHash(
                requestId,
            );
            expect(bytecodeHash).to.not.be.undefined;
            expect(bytecodeHash).to.equal(
                ethers.utils.keccak256(bytecodeToDeploy),
            );
    
            let currentBestSourceSalt;
            let currentBestAddress = ethers.utils.getCreate2Address
            (
                D3CAFRequest.factory,
                currentBestSalt,
                D3CAFRequest.bytecodeHash,
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
                        D3CAFRequest.factory,
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
            let tx1 = await upgradable.connect(deterministicTestSigner).registerResponse(
                requestId,
                currentBestSalt,
            );
    
            let rc1 = await tx1.wait();
            const event1 = rc1.events?.find((e: any) => e.event === "OnNewSalt");
            expect(event1).to.not.be.undefined;
            
            mineUpTo(ethers.BigNumber.from(D3CAFRequest.expireAt).add(1).toNumber());
            let oldBalance = await ethers.provider.getBalance(solver.address);
    
            let tx2 = await upgradable.connect(deterministicTestSigner).claimReward(
                requestId,
                solver.address,
                currentBestSourceSalt,
            );
            let rc2 = await tx2.wait();
            const event2 = rc2.events?.find((e: any) => e.event === "OnClaimD3CAFReward");
            expect(event2).to.not.be.undefined;
            // check that reward ethers are transfered to solver
            const newBalance = await ethers.provider.getBalance(solver.address);
            expect(newBalance).to.not.be.undefined;
            const commissionRateBasisPoint =
                await upgradable.getComissionRateBasisPoints();
            expect(commissionRateBasisPoint).to.equal(500);
            const newCommissionReceiverBalance = await ethers.provider.getBalance(commissionReceiver.address);
            const expectedCommission = D3CAFRequest.rewardAmount.mul(commissionRateBasisPoint).div(10000);
            expect(newCommissionReceiverBalance.sub(oldCommissionReceiverBalance)).to.equal(expectedCommission);
            expect(newBalance.sub(oldBalance)).to.equal(
                D3CAFRequest.rewardAmount.mul(
                    ethers.BigNumber.from(10000).sub(commissionRateBasisPoint)).div(10000)
                );
            
            let tx3 = await deterministicFactory.connect(deterministicTestSigner).deploy(
                currentBestSalt,
                bytecodeToDeploy
            );
            
            let rc3 = await tx3.wait();
            const event3 = rc3.events?.find((e: any) => e.event === "OnDeploy");
            expect(event3).to.not.be.undefined;
            const deployedAddress = event3?.args?.addr;
            expect(deployedAddress).to.not.be.undefined;
            expect(deployedAddress).to.equal(currentBestAddress);
            console.log("deployedAddress: ", deployedAddress);
            console.log("currentBestSalt: ", currentBestSalt);

            const deployedContract = testSumContractArtifact.attach(deployedAddress);
            expect(deployedContract).to.not.be.undefined;
            expect(await deployedContract.value()).to.equal(0);
            await deployedContract.add(1)
            expect(await deployedContract.value()).to.equal(1);
            await deployedContract.add(2)
            expect(await deployedContract.value()).to.equal(3);
        });

        it("Should be able to withdraw a request that has no submission.", async function() {
            const {
                owner,
                addr1: solver,
                addr2: commissionReceiver,
                addr3: requester,
                addr4: refundReceiver,
                deterministicFactory,
                upgradable,
                deterministicTestSigner,
                bytecodeToDeploy,
                testSumContractArtifact
            } = await loadFixture(deployFixture);
    
            const currentBlock = await ethers.provider.getBlockNumber();
            
            const deadline = 10;
            const rewardAmountInWei = ethers.utils.parseEther("1.0");

            // const initSalt = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
            const initSalt = "0x3f68e79174daf15b50e15833babc8eb7743e730bb9606f922c48e95314c3905c";
    
            const D3CAFRequest = 
                {
                    factory: deterministicFactory.address,
                    bytecodeHash: ethers.utils.keccak256(bytecodeToDeploy),
                    expireAt: ethers.utils.hexlify(currentBlock + deadline),
                    initSalt,
                    rewardType: ethers.constants.Zero,
                    rewardAmount: rewardAmountInWei,
                    rewardToken: ethers.constants.AddressZero,
                    refundReceiver: refundReceiver.address,
                };
    
            let tx = (await upgradable.connect(requester)
                .registerCreate2Request(
                    D3CAFRequest,
                    {
                        value: rewardAmountInWei,
                    }
                ));
            expect(await upgradable.getCommissionReceiver()).to.equal(owner.address);
            await upgradable.setCommissionReceiver(commissionReceiver.address);
            let rc = await tx.wait();
            const event = rc.events?.find((e: any) => e.event === "OnRegisterD3CAFRequest");
            expect(event).to.not.be.undefined;
            const requestId = event?.args?.requestId;
            expect(requestId).to.not.be.undefined;
            const expectedRequestId = await upgradable.computeRequestId(
                D3CAFRequest,
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
            expect(savedFactory).to.equal(D3CAFRequest.factory);
            let bytecodeHash = await upgradable.getBytecodeHash(
                requestId,
            );
            expect(bytecodeHash).to.not.be.undefined;
            expect(bytecodeHash).to.equal(
                ethers.utils.keccak256(bytecodeToDeploy),
            );
    
            let currentBestSourceSalt;
            let currentBestAddress = ethers.utils.getCreate2Address
            (
                D3CAFRequest.factory,
                currentBestSalt,
                D3CAFRequest.bytecodeHash,
            );
            
            expect(currentBestAddress).to.not.be.undefined;
            const computedAddress = await upgradable.computeAddress(
                requestId,
                currentBestSalt,
            );
    
            expect(currentBestAddress).to.equal(computedAddress);
            mineUpTo(currentBlock + deadline + 1);
            let oldBalance = await ethers.provider.getBalance(D3CAFRequest.refundReceiver);
            let tx2 = await upgradable.connect(requester).requesterWithdraw(requestId);
            let rc2 = await tx2.wait();
            const event2 = rc2.events?.find((e: any) => e.event === "OnClearD3CAFRequest");
            let newBalance = await ethers.provider.getBalance(D3CAFRequest.refundReceiver);
            expect(newBalance.sub(oldBalance)).to.equal(rewardAmountInWei);
        });
    });

    it("Should have owner as the default commissionReceiver", async function() {
        const {
            owner,
            addr1: solver,
            addr2: commissionReceiver,
            addr3: requester,
            addr4: refundReceiver,
            deterministicFactory,
            upgradable,
            deterministicTestSigner,
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
            to: deterministicTestSigner.address,
            value: ethers.utils.parseEther("2.0"),
        });
        
        const deadline = 10;
        const rewardAmountInWei = ethers.utils.parseEther("1.0");
        const D3CAFRequest = 
            {
                factory: deterministicFactory.address,
                bytecodeHash: ethers.utils.keccak256(contractArtifact.bytecode),
                expireAt: ethers.utils.hexlify(currentBlock + deadline),
                initSalt: ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
                rewardType: ethers.constants.Zero,
                rewardAmount: ethers.constants.Zero,
                rewardToken: ethers.constants.AddressZero,
                refundReceiver: refundReceiver.address,
            };
        
        // const initSalt = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
        const initSalt = "0x3f68e79174daf15b50e15833babc8eb7743e730bb9606f922c48e95314c3905c";

        let tx = (await upgradable.connect(requester)
            .registerCreate2Request(
                D3CAFRequest
            ));
        expect(await upgradable.getCommissionReceiver()).to.equal(owner.address);
    });


    it("Should be able to set and read commission rate", async function() {
        const {
            owner,
            addr1: solver,
            addr2: commissionReceiver,
            addr3: requester,
            addr4: refundReceiver,
            deterministicFactory,
            upgradable,
            deterministicTestSigner,
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
            to: deterministicTestSigner.address,
            value: ethers.utils.parseEther("2.0"),
        });
        
        const deadline = 10;
        const rewardAmountInWei = ethers.utils.parseEther("1.0");
        const D3CAFRequest = 
            {
                factory: deterministicFactory.address,
                bytecodeHash: ethers.utils.keccak256(contractArtifact.bytecode),
                expireAt: ethers.utils.hexlify(currentBlock + deadline),
                initSalt: ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
                rewardType: ethers.constants.Zero,
                rewardAmount: ethers.constants.Zero,
                rewardToken: ethers.constants.AddressZero,
                refundReceiver: refundReceiver.address,
            };
        
        // const initSalt = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
        const initSalt = "0x3f68e79174daf15b50e15833babc8eb7743e730bb9606f922c48e95314c3905c";

        let tx = (await upgradable.connect(requester)
            .registerCreate2Request(
                D3CAFRequest
            ));
        await upgradable.setComissionRateBasisPoints(1000);
        expect(await upgradable.getComissionRateBasisPoints()).to.equal(1000);
    });

    it("Should be able to set and get create2Requests", async function() {
        const {
            owner,
            addr1: solver,
            addr2: commissionReceiver,
            addr3: requester,
            addr4: refundReceiver,
            deterministicFactory,
            upgradable,
            deterministicTestSigner,
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
            to: deterministicTestSigner.address,
            value: ethers.utils.parseEther("2.0"),
        });
        
        const deadline = 10;
        const rewardAmountInWei = ethers.utils.parseEther("1.0");
        const D3CAFRequest = 
            {
                factory: deterministicFactory.address,
                bytecodeHash: ethers.utils.keccak256(contractArtifact.bytecode),
                expireAt: ethers.utils.hexlify(currentBlock + deadline),
                initSalt: ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
                rewardType: ethers.constants.Zero,
                rewardAmount: ethers.constants.Zero,
                rewardToken: ethers.constants.AddressZero,
                refundReceiver: refundReceiver.address,
            };
        
        let tx = (await upgradable.connect(requester)
            .registerCreate2Request(
                D3CAFRequest
            ));
        let rc = await tx.wait();
        const event = rc.events?.find((e: any) => e.event === "OnRegisterD3CAFRequest");
        expect(event).to.not.be.undefined;
        const requestId = event?.args?.requestId;
        const retrievedRequest = await upgradable.getCreate2Request(requestId);
        expect(retrievedRequest).to.not.be.undefined;
        expect(retrievedRequest?.factory).to.equal(deterministicFactory.address);
        expect(retrievedRequest?.bytecodeHash).to.equal(ethers.utils.keccak256(contractArtifact.bytecode));
        expect(retrievedRequest?.expireAt).to.equal(ethers.utils.hexlify(currentBlock + deadline));
        expect(retrievedRequest?.initSalt).to.equal(ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32));
        expect(retrievedRequest?.rewardType).to.equal(ethers.constants.Zero);
        expect(retrievedRequest?.rewardAmount).to.equal(ethers.constants.Zero);
        expect(retrievedRequest?.rewardToken).to.equal(ethers.constants.AddressZero);
        expect(retrievedRequest?.refundReceiver).to.equal(refundReceiver.address);
    });


    it("Should be able to set and get tMaxDeadlineBlockDuration", async function() {
        const {
            owner,
            addr1: solver,
            addr2: commissionReceiver,
            addr3: requester,
            addr4: refundReceiver,
            deterministicFactory,
            upgradable,
            deterministicTestSigner,
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
            to: deterministicTestSigner.address,
            value: ethers.utils.parseEther("2.0"),
        });
        
        const deadline = 10;
        const rewardAmountInWei = ethers.utils.parseEther("1.0");
        const D3CAFRequest = 
            {
                factory: deterministicFactory.address,
                bytecodeHash: ethers.utils.keccak256(contractArtifact.bytecode),
                expireAt: ethers.utils.hexlify(currentBlock + deadline),
                initSalt: ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
                rewardType: ethers.constants.Zero,
                rewardAmount: ethers.constants.Zero,
                rewardToken: ethers.constants.AddressZero,
                refundReceiver: refundReceiver.address,
            };
        
        expect(await upgradable.connect(requester).getMaxDeadlineBlockDuration()).to.equal(604800 / 12);
        await upgradable.connect(owner).setMaxDeadlineBlockDuration(100);
        expect(await upgradable.connect(requester).getMaxDeadlineBlockDuration()).to.equal(100);

    
    });
});