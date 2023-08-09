// SPDX-License-Identifier: Apache-2.0
// Author: D3Serve Labs Inc. <team@d3serve.xyz>
// Source Code Repo: https://github.com/d3servelabs/d3caf

pragma solidity ^0.8.0;

contract TestingSum {
    uint256 public value;
    constructor() {
        value = 99;
    }
    
    function add(uint256 x) public {
        value += x;
    }
}