// SPDX-License-Identifier: Apache-2.0
// Author: D3Serve Labs Inc. <team@d3serve.xyz>
// Source Code Repo: https://github.com/d3servelabs/d3caf

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";

contract TestingCreate2Deployer {
    // using Create2
    // for bytes32;
    event OnDeploy(address addr);

    function deploy(bytes32 salt, bytes memory bytecode) external payable returns (address) {
        address deployed = Create2.deploy(msg.value, salt, bytecode);
        emit OnDeploy(deployed);
        return deployed;
    }
}