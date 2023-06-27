import { loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { deployByName } from "../utils/deployUtil";

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

        return {
            owner,
            addr1, addr2,
            logic, proxy
        };
    };

    it("Should be able to deploy.", async function() {
        const {
            owner,
            logic, proxy
        } = await loadFixture(deployFixture);
    });
});