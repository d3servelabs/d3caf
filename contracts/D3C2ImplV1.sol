// SPDX-License-Identifier: Apache-2.0
// Author: Zainan Victor Zhou <zzn-ercref@zzn.im>
// Visit our open source repo: http://zzn.li/ercref

pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "@ercref/contracts/drafts/IERC5732.sol";

enum RewardType {
    ETH,
    ERC20
}

/// @title D3C2Request
/// @dev Represents a D3C2 request.
struct D3C2Request {
    /// @dev The address of the factory.
    address factory;
    /// @dev The hash of the bytecode.
    bytes32 bytecodeHash;
    /// @dev After this block, the request is considered expired and reward can be claimed.
    uint256 expireAt;
    /// @dev The type of reward.
    RewardType rewardType;
    /// @dev The reward amount for the request.
    ///      For Ethers the unit will be `wei`.
    uint256 rewardAmount;
    /// @dev The reward token address.
    /// For ETH, this is Zero. Non-Zeros are reserved for ERC20 and future extensions.
    address rewardToken;

    /// @dev The address of the refund receiver.
    address payable refundReceiver;
}

/// @title D3C2ImplV1
/// @notice This contract implements the D3C2 mechanism.
/// @dev Economic Mechanism:
/// - Criteria: any GeneratedAddress **lower than** the Bar is eligible for reward.
///   - The commission rate is a parameter, currently 0%.
///   - The commission is paid to the commissionRecipient.
///   - Currently supports ETH and hopes to support ERC20 in the future by extending the type.
/// - When there is no submission that meets the criteria before the deadline,
///   the reward is returned to the submitter.
/// - When there are multiple submissions before the deadline that meet the criteria,
///   the submitter who submitted the lowest address is considered "the winner"
///   and can claim the reward.
contract D3C2ImplV1 is Initializable, ContextUpgradeable, OwnableUpgradeable {
    using SafeMath for uint256;

    uint256 private comissionRateBasisPoints;
    address payable private commissionReceiver;
    // max to be two weeks in blocks
    uint256 private maxDeadlineBlockDuration;

    // TODO(xinbenlv): determine what's a good requestId structure;
    mapping(bytes32 /* RequestId */ => D3C2Request) private create2Requests;
    mapping(bytes32 /* RequestId */ => bytes32) private currentBestSalt;

    event OnRegisterD3C2Request(
        bytes32 indexed requestId
    );

    event OnClearD3C2Request(bytes32 indexed requestId);
    event OnNewSalt(
        bytes32 indexed requestId, 
        bytes32 indexed salt,
        address indexed calculatedAddress
    );

    event OnClaimD3C2Reward(
        bytes32 indexed requestId,
        address indexed winner,
        bytes32 indexed salt,
        address calculatedAddress,
        uint256 rewardAmount,
        address rewardToken
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Calculates the input salt for Create2 a given reward receiver address and raw salt.
     *      The purpose is to prevent front-running.
     * @param rewardReceiver The address of the reward receiver.
     * @param sourceSalt The source salt for the input of compositeSalt.
     * @return The calculated salt.
     */
    function _computeSalt(
        address rewardReceiver,
        bytes32 sourceSalt
    ) internal pure returns (bytes32) {
        // Add "V1" to the pack to prevent collision with future versions.
        return keccak256(abi.encodePacked(rewardReceiver, sourceSalt));
    }

    function _computeAddress(bytes32 requestId, bytes32 salt) internal view returns (address) {
        D3C2Request memory _request = create2Requests[requestId];
        return Create2.computeAddress(
            salt,
            _request.bytecodeHash,
            _request.factory
        );
    }

    function computeAddress(bytes32 requestId, bytes32 salt) public view returns (address) {
        return _computeAddress(requestId, salt);
    }

    function computeSalt(
        address sender,
        bytes32 rawSalt
    ) public pure returns (bytes32) {
        return _computeSalt(sender, rawSalt);
    }

    /**
     * @dev Clears the request from the storage.
     * @param requestId The requestId of the request.
     */
    function _clearRequest(bytes32 requestId) internal {
        delete create2Requests[requestId];
        delete currentBestSalt[requestId];
        emit OnClearD3C2Request(requestId);
    }

    function _computeRequestId(
        D3C2Request memory _request
    ) internal pure returns (bytes32 requestId) {
        // TODO: consider if replay protection is needed
        return
            keccak256(
                abi.encodePacked(
                    _request.factory,
                    _request.bytecodeHash,
                    _request.expireAt,
                    _request.refundReceiver
                )
            );
    }

    // Also expose computeRequestId as a public function
    function computeRequestId(
        D3C2Request memory _request
    ) public pure returns (bytes32 requestId) {
        return _computeRequestId(_request);
    }

    function getFactory(bytes32 requestId) external view returns (address) {
        return create2Requests[requestId].factory;
    }

    function getBytecodeHash(bytes32 requestId) external view returns (bytes32) {
        return create2Requests[requestId].bytecodeHash;
    }

    function initialize() public initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        maxDeadlineBlockDuration = 604800 / 12; // 2 weeks 
        commissionReceiver = payable(owner());
        comissionRateBasisPoints = 500; // 5%
    }

    function setCommissionReceiver(address payable _commissionReceiver) external onlyOwner {
        commissionReceiver = _commissionReceiver;
    }

    function getCommissionReceiver() external view returns (address payable) {
        return commissionReceiver;
    }

    function setComissionRateBasisPoints(uint256 _comissionRateBasisPoints) external onlyOwner {
        require(_comissionRateBasisPoints <= 10000, "D3C2: comission invalid");
        comissionRateBasisPoints = _comissionRateBasisPoints;
    }

    function getComissionRateBasisPoints() external view returns (uint256) {
        return comissionRateBasisPoints;
    }

    function setMaxDeadlineBlockDuration(uint256 _maxDeadlineBlockDuration) external onlyOwner {
        maxDeadlineBlockDuration = _maxDeadlineBlockDuration;
    }

    function getMaxDeadlineBlockDuration() external view returns (uint256) {
        return maxDeadlineBlockDuration;
    }

    function registerCreate2Request(
        D3C2Request memory _request,
        bytes32 _initSalt
    ) external payable returns (bytes32) {
        require(_request.expireAt > block.number, "D3C2: request expired");
        require(
            _request.expireAt <= block.number + maxDeadlineBlockDuration,
            "D3C2: deadline too far"
        );
        require(_request.refundReceiver != address(0), "D3C2: refundReceiver not set");
        require(_request.factory != address(0), "D3C2: factory not set");

        require(_request.rewardType == RewardType.ETH, "D3C2: only $ETH supported");
        require(_request.rewardToken == address(0), "D3C2: only $ETH supported");
        require(msg.value == _request.rewardAmount, "D3C2: reward amount does not match");

        bytes32 requestId = _computeRequestId(_request);
        require(create2Requests[requestId].expireAt == 0, "D3C2: requestId already exists");
        create2Requests[_computeRequestId(_request)] = _request;
        currentBestSalt[requestId] = _initSalt;
        
        address calculatedAddress = Create2.computeAddress(
            _initSalt,
            _request.bytecodeHash,
            _request.factory
        );

        emit OnNewSalt(requestId, _initSalt, calculatedAddress);
        emit OnRegisterD3C2Request(
            requestId
        );

        return requestId;
    }

    function registerResponse(bytes32 requestId, bytes32 salt) external payable {
        D3C2Request memory request = create2Requests[requestId];
        require(request.expireAt > block.number, "D3C2: expired");
        address lastBestAddress = _computeAddress(requestId, currentBestSalt[requestId]);
        address newAddress = _computeAddress(requestId, salt);

        require(newAddress <= address(uint160(lastBestAddress) / (2 ** 4)), 
            "D3C2: At least one more zero");
        currentBestSalt[requestId] = salt;
        emit OnNewSalt(
            requestId, 
            salt, 
            newAddress);
    }

    function claimReward(
        bytes32 requestId, 
        address payable winner, 
        bytes32 sourceSalt) external {
        D3C2Request memory request = create2Requests[requestId];
        // Deadlined is passed
        require(request.expireAt <= block.number, "D3C2: request is not expired");

        // reveal the salt calculator
        bytes32 salt = _computeSalt(winner, sourceSalt);
        require(currentBestSalt[requestId] == salt, "D3C2: salt not matched");

        address computedAddress = Create2.computeAddress(
            salt,
            request.bytecodeHash,
            request.factory
        );
        emit OnClaimD3C2Reward(
            requestId,
            winner,
            salt,
            computedAddress,
            request.rewardAmount,
            request.rewardToken
        );

        _clearRequest(requestId);

        require(request.rewardType == RewardType.ETH, "D3C2: unknown reward type");
        require(request.rewardToken == address(0), "D3C2: unknown reward token");
        // use safeMath for uint256 commission = request.rewardAmount * comissionBasisPoints / 10000;
        uint256 commission = request.rewardAmount.mul(comissionRateBasisPoints).div(10000);

        commissionReceiver.transfer(commission);
        uint256 remainder = request.rewardAmount.sub(commission);
        winner.transfer(remainder);
    }

    function getCurrentBestSalt(bytes32 requestId) external view returns (bytes32) {
        return currentBestSalt[requestId];
    }

    // Allow requester to claim back the reward if no submission meet the bar yet.
    function requesterWithdraw(bytes32 requestId) external {
        D3C2Request memory request = create2Requests[requestId];

        // Deadlined is passed MUST be checked otherwise the requester
        // could front-run the claimReward
        require(request.expireAt <= block.number, "D3C2: too soon");
        require(currentBestSalt[requestId] == 0, "D3C2: no winning salt");
        _clearRequest(requestId);

        // TODO deal with different reward types
        request.refundReceiver.transfer(request.rewardAmount);
    }

    function getCreate2Request(bytes32 requestId) external view returns (D3C2Request memory) {
        return create2Requests[requestId];
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
