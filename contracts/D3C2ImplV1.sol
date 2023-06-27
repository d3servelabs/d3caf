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
    /// @dev The calculated address needs to be lower than this bar to be worthy of the reward.
    address bar;
    /// @dev The type of reward.
    RewardType rewardType;
    /// @dev The address that will receive the refund.
    address payable refundReceiver;
    /// @dev The reward amount for the request.
    uint256 rewardAmount;
    /// @dev The reward token address.
    /// For ETH, this is Zero. Non-Zeros are reserved for ERC20 and future extensions.
    address rewardToken;
}

struct D3C2Response {
    bytes32 requestId;
    bytes32 salt;
    address calculatedAddress;
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

    uint256 private comissionBasisPoints;
    address payable private commissionReceiver;
    // max to be two weeks in blocks
    uint256 private maxDeadlineBlockDuration;

    // TODO(xinbenlv): determine what's a good requestId structure;
    mapping(bytes32 /* RequestId */ => D3C2Request) private create2Requests;
    mapping(bytes32 /* RequestId */ => address) private currentMinAddress;
    mapping(bytes32 /* RequestId */ => bytes32) private currentWinningSalts;

    event OnRegisterD3C2Request(
        bytes32 indexed requestId,
        address indexed factory,
        bytes32 indexed bytecodeHash,
        uint256 expireAt,
        address bar,
        address payable refundReceiver,
        RewardType rewardType,
        uint256 rewardAmount,
        address rewardToken
    );

    event OnClearD3C2Request(bytes32 indexed requestId);

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
     * @param rawSalt The raw salt used to calculate the address.
     * @return The calculated salt.
     */
    function _calculateCommittedSalt(
        address payable rewardReceiver,
        bytes32 rawSalt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(rewardReceiver, rawSalt));
    }

    /**
     * @dev Clears the request from the storage.
     * @param requestId The requestId of the request.
     */
    function _clearRequest(bytes32 requestId) internal {
        delete create2Requests[requestId];
        delete currentMinAddress[requestId];
        delete currentWinningSalts[requestId];
        emit OnClearD3C2Request(requestId);
    }

    function _calculateRequestId(
        D3C2Request memory _request
    ) internal pure returns (bytes32 requestId) {
        // TODO: consider if replay protection is needed
        return
            keccak256(
                abi.encodePacked(
                    // We include refundReceiver to prevent someone else from
                    // front-running the request and make it impossible for
                    // the requester to register their intended request.
                    _request.refundReceiver,
                    _request.factory,
                    _request.bytecodeHash,
                    // TODO consider if bar should be part of the requestId
                    _request.bar,
                    // TODO consider if expireAt should be part of the requestId
                    _request.expireAt
                )
            );
    }

    function initialize() public initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
    }

    function setCommissionReceiver(address payable _commissionReceiver) external onlyOwner {
        commissionReceiver = _commissionReceiver;
    }

    function getCommissionReceiver() external view returns (address payable) {
        return commissionReceiver;
    }

    function setComissionBasisPoints(uint256 _comissionBasisPoints) external onlyOwner {
        require(_comissionBasisPoints <= 10000, "D3C2: comission invalid");
        comissionBasisPoints = _comissionBasisPoints;
    }

    function getComissionBasisPoints() external view returns (uint256) {
        return comissionBasisPoints;
    }

    function setMaxDeadlineBlockDuration(uint256 _maxDeadlineBlockDuration) external onlyOwner {
        maxDeadlineBlockDuration = _maxDeadlineBlockDuration;
    }

    function getMaxDeadlineBlockDuration() external view returns (uint256) {
        return maxDeadlineBlockDuration;
    }

    function registerCreate2Request(
        D3C2Request memory _request
    ) external payable returns (bytes32) {
        uint256 reward = _request.rewardAmount;
        uint256 commission = reward.mul(comissionBasisPoints).div(10000);
        uint256 totalCharge = reward.add(commission);
        require(_request.expireAt > block.number, "D3C2: request expired");
        require(
            _request.expireAt <= block.number + maxDeadlineBlockDuration,
            "D3C2: deadline too far"
        );
        require(_request.refundReceiver != address(0), "D3C2: refundReceiver not set");
        require(_request.factory != address(0), "D3C2: factory not set");
        // Make sure a bar is set
        require(_request.bar != address(0), "D3C2: bar must be set");
        require(_request.rewardType == RewardType.ETH, "D3C2: only $ETH supported");
        require(_request.rewardToken == address(0), "D3C2: only $ETH supported");

        require(msg.value >= totalCharge, "D3C2: reward amount does not match");
        address payable payee = commissionReceiver;
        require(payee != address(0), "D3C2: commissionReceiver not set");
        payee.transfer(commission);

        bytes32 requestId = _calculateRequestId(_request);
        require(create2Requests[requestId].expireAt == 0, "D3C2: requestId already exists");
        create2Requests[_calculateRequestId(_request)] = _request;

        // Return the remainder to the sender
        // TODO doublecheck if this is the right way for ContextUpgradaabe.
        _request.refundReceiver.transfer(msg.value - totalCharge);

        emit OnRegisterD3C2Request(
            requestId,
            _request.factory,
            _request.bytecodeHash,
            _request.expireAt,
            _request.bar,
            _request.refundReceiver,
            _request.rewardType,
            _request.rewardAmount,
            _request.rewardToken
        );

        return requestId;
    }

    function registerResponse(D3C2Response memory _response) external payable {
        D3C2Request memory request = create2Requests[_response.requestId];
        require(request.expireAt > block.number, "D3C2: expired");
        require(request.bar > _response.calculatedAddress, "D3C2: address above bar");
        require(
            currentMinAddress[_response.requestId] > _response.calculatedAddress,
            "D3C2: address not better"
        );
        require(currentWinningSalts[_response.salt] == 0, "D3C2: salt seen");
        currentWinningSalts[_response.requestId] = _response.salt;
    }

    function claimReward(bytes32 requestId, address payable winner, bytes32 rawSalt) external {
        D3C2Request memory request = create2Requests[requestId];
        // Deadlined is passed
        require(request.expireAt <= block.number, "D3C2: request is not expired");

        // reveal the salt calculator
        bytes32 salt = _calculateCommittedSalt(winner, rawSalt);
        require(currentWinningSalts[requestId] == salt, "D3C2: salt not matched");

        emit OnClaimD3C2Reward(
            requestId,
            winner,
            salt,
            currentMinAddress[requestId],
            request.rewardAmount,
            request.rewardToken
        );

        _clearRequest(requestId);

        // THIS SHOULD ALREADY BE CHECKED IN registerCreate2Request but just in case.
        require(request.rewardType == RewardType.ETH, "D3C2: unknown reward type");

        // TODO deal with different reward types
        winner.transfer(request.rewardAmount);
    }

    // Allow requester to claim back the reward if no submission meet the bar yet.
    function requesterWithdraw(bytes32 requestId) external {
        D3C2Request memory request = create2Requests[requestId];

        // Deadlined is passed MUST be checked otherwise the requester
        // could front-run the claimReward
        require(request.expireAt <= block.number, "D3C2: too soon");
        require(currentWinningSalts[requestId] == 0, "D3C2: no winning salt");
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
