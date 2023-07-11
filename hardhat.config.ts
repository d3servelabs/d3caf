import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-ethers';
import "@openzeppelin/hardhat-upgrades";
import "@truffle/dashboard-hardhat-plugin";
import "hardhat-gas-reporter";
import { HardhatUserConfig, task } from 'hardhat/config';
import * as dotenv from 'dotenv';
import './tasks/prod';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['storageLayout'],
        },
      },
    },
  },
  networks: {
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: {
        mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk",
      },
    },
    goerli: {
      url: `https://eth-goerli.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts: {
        mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk",
      },
      // gasPrice: 5000000000 // 5 gwei
    },
    dashboard: {
      url: "http://localhost:24012/rpc",
      timeout: 1200000,
    },
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || "",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY as string,
      goerli: process.env.ETHERSCAN_API_KEY as string,
      dashboard: process.env.ETHERSCAN_API_KEY as string,
    },
    customChains: [
      {
        network: "dashboard",
        chainId: 5,
        urls: {
          apiURL: "https://api-goerli.etherscan.io/api",
          browserURL: "https://goerli.etherscan.io"
        }
      }
    ]
  },
  // truffle: {}
};

export default config;
