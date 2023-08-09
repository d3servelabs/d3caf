// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

abstract contract Creator {
    function _calculateAddress(address creator, bytes32 salt, bytes32 hash) internal pure returns (address) {
        bytes32 _data = keccak256(
            abi.encodePacked(bytes1(0xff), creator, salt, hash)
        );
        return address(bytes20(_data << 96));
    }

    function _deploy(bytes32 salt, bytes memory bytecode) internal returns (address) {
        address addr;
        assembly {
            addr := create2(callvalue(), add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(addr) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        return addr;
    }
}

contract Premine is Creator {
    event Creation(address indexed target, address delegatecallTarget);

    bytes constant initBytecode = hex"5863b34a049881526020816004601c335afa508081828384515af43d8083843e9190602657fd5bf3";
    bytes32 constant public initHash = keccak256(initBytecode);
    address public currentDelegatecallTarget;

    function calculateAddress(bytes32 salt) public view returns (address) {
        return _calculateAddress(address(this), salt, initHash);
    }

    function deploy(bytes32 salt, address delegatecallTarget) external payable returns (address) {
        currentDelegatecallTarget = delegatecallTarget;
        address target = _deploy(salt, initBytecode);

        // Need to prevent zero length contracts, since the Control Token can't
        // differentiate between a self-destructed contract and a still deployed
        // zero-length contract.
        uint256 codelen;
        assembly {
            codelen := extcodesize(target)
        }
        require(0 != codelen, "Deploy: sz == 0");

        emit Creation(target, delegatecallTarget);
        return target;
    }

    function proxy(address target, bytes memory data) external payable {
        assembly {
            let result := call(
                gas(),              // Gas sent with call
                target,             // Contract to call
                callvalue(),        // Wei to send with call
                add(data, 0x20),    // Pointer to calldata
                mload(data),        // Length of call data
                0,                  // Pointer to return buffer
                0                   // Length of return buffer
            )
            returndatacopy(0, 0, returndatasize())
            switch result
                case 0 {
                    revert(0, returndatasize())
                }
                default {
                    return(0, returndatasize())
                }
        }
    }
}
