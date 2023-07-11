// SPDX-License-Identifier: Apache-2.0
// Author: Zainan Victor Zhou <zzn-ercref@zzn.im>
// Visit our open source repo: http://zzn.li/ercref
pragma solidity 0.8.17;

contract TestingSum {
    uint256 public value;

    function add(uint256 x) public {
        value += x;
    }
}