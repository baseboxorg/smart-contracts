pragma solidity 0.4.18;


import "./ERC20Interface.sol";
import "./Utils.sol";
import "./Withdrawable.sol";
import "./KyberReserveInterface.sol";

interface MakerDao {
    function peek() public view returns (bytes32, bool);
}

contract DigixReserve is KyberReserveInterface, Withdrawable, Utils {

    ERC20 public digix;
    MakerDao public makerDaoContract;
    uint maxBlockDrift = 300;
    mapping(bytes32=>bool) public approvedWithdrawAddresses; // sha3(token,address)=>bool
    address public kyberNetwork;
    uint public lastPriceFeed;
    bool public tradeEnabled;
    uint constant internal POW_2_64 = 2 ** 64;
    uint constant digixDecimals = 9;
    uint buyCommissionBps = 13;
    uint sellCommissionBps = 13;


    function DigixReserve(address _admin, address _kyberNetwork, ERC20 _digix) public{
        require(_admin != address(0));
        require(_digix != address(0));
        require(_kyberNetwork != address(0));
        admin = _admin;
        digix = _digix;
        setDecimals(digix);
        kyberNetwork = _kyberNetwork;
        tradeEnabled = true;
    }

    function () public payable {}

    /// @dev Add digix price feed. Valid for @maxBlockDrift blocks
    /// @param blockNumber - the block this price feed was signed.
    /// @param nonce - the nonce with which this block was signed.
    /// @param ask ask price dollars per Kg gold == 1000 digix
    /// @param bid bid price dollars per KG gold == 1000 digix
    /// @param signature signature of keccak 256 hash of (block, nonce, ask, bid)
    function addPriceFeed(uint blockNumber, uint nonce, uint ask, uint bid, bytes signature) public {
        uint prevFeedBlock;
        uint prevNonce;
        uint prevAsk;
        uint prevBid;

        (prevFeedBlock, prevNonce, prevAsk, prevBid) = getLastPriceFeedValues();
        require(nonce > prevNonce);

        signature;
        //        address signer =
//        bool isValidSigner = false;
//        for (uint i = 0; i < operatorsGroup.length; i++) {
//            if (operatorsGroup[i] == signer){
//                isValidSigner = true;
//                break;
//            }
//        }
//        require(isValidSigner);

        lastPriceFeed = encodePriceFeed(blockNumber, nonce, ask, bid);
    }

    function getConversionRate(ERC20 src, ERC20 dest, uint srcQty, uint blockNumber) public view returns(uint) {
        if (!tradeEnabled) return 0;
        if (makerDaoContract == MakerDao(0)) return 0;
        uint feedBlock;
        uint nonce;
        uint ask;
        uint bid;
        blockNumber;

        (feedBlock, nonce, ask, bid) = getLastPriceFeedValues();
        if (feedBlock + maxBlockDrift < block.number) return 0;

        uint rate1000Digix;

        if (ETH_TOKEN_ADDRESS == src) {
            rate1000Digix = ask;
        } else if (ETH_TOKEN_ADDRESS == dest) {
            rate1000Digix = bid;
        } else {
            return 0;
        }

        // wei per dollar from makerDao
        bool isRateValid;
        bytes32 weiPerDoller;
        (weiPerDoller, isRateValid) = makerDaoContract.peek();
        if (!isRateValid) return 0;

        uint rate = rate1000Digix * (10 ** 18) * PRECISION / uint(weiPerDoller) / 1000;

        uint destQty = getDestQty(src, dest, srcQty, rate);

        if (getBalance(dest) < destQty) return 0;

//        if (sanityRatesContract != address(0)) {
//            uint sanityRate = sanityRatesContract.getSanityRate(src, dest);
//            if (rate > sanityRate) return 0;
//        }
        return rate;
    }

    function getLastPriceFeedValues() public view returns(uint feedBlock, uint nonce, uint ask, uint bid) {
        (feedBlock, nonce, ask, bid) = decodePriceFeed(lastPriceFeed);
    }

    event TradeExecute(
        address indexed origin,
        address src,
        uint srcAmount,
        address destToken,
        uint destAmount,
        address destAddress
    );

    function trade(
        ERC20 srcToken,
        uint srcAmount,
        ERC20 destToken,
        address destAddress,
        uint conversionRate,
        bool validate
    )
        public
        payable
        returns(bool)
    {
        require(tradeEnabled);
        require(msg.sender == kyberNetwork);

        // can skip validation if done at kyber network level
        if (validate) {
            require(conversionRate > 0);
            if (srcToken == ETH_TOKEN_ADDRESS)
                require(msg.value == srcAmount);
            else
                require(msg.value == 0);
        }

        uint destAmount = getDestQty(srcToken, destToken, srcAmount, conversionRate);
        uint adjustedAmount;
        // sanity check
        require(destAmount > 0);

        // collect src tokens
        if (srcToken != ETH_TOKEN_ADDRESS) {
            //due to commission network has less tokens. take amount less commission
            adjustedAmount = srcAmount * (10000 - sellCommissionBps) / 10000;
            require(srcToken.transferFrom(msg.sender, this, adjustedAmount));
        }

        // send dest tokens
        if (destToken == ETH_TOKEN_ADDRESS) {
            destAddress.transfer(destAmount);
        } else {
            adjustedAmount = destAmount * 10000 / (10000 - buyCommissionBps);
            require(destToken.transfer(destAddress, adjustedAmount));
        }

        TradeExecute(msg.sender, srcToken, srcAmount, destToken, destAmount, destAddress);

        return true;
    }

    event TradeEnabled(bool enable);

    function enableTrade() public onlyAdmin returns(bool) {
        tradeEnabled = true;
        TradeEnabled(true);

        return true;
    }

    function disableTrade() public onlyAlerter returns(bool) {
        tradeEnabled = false;
        TradeEnabled(false);

        return true;
    }

    event WithdrawAddressApproved(ERC20 token, address addr, bool approve);

    function approveWithdrawAddress(ERC20 token, address addr, bool approve) public onlyAdmin {
        approvedWithdrawAddresses[keccak256(token, addr)] = approve;
        WithdrawAddressApproved(token, addr, approve);

        setDecimals(token);
    }

    event WithdrawFunds(ERC20 token, uint amount, address destination);

    function withdraw(ERC20 token, uint amount, address destination) public onlyOperator returns(bool) {
        require(approvedWithdrawAddresses[keccak256(token, destination)]);

        if (token == ETH_TOKEN_ADDRESS) {
            destination.transfer(amount);
        } else {
            require(token.transfer(destination, amount));
        }

        WithdrawFunds(token, amount, destination);

        return true;
    }

    function setMakerDaoContract(MakerDao daoContract) public onlyAdmin{
        require(daoContract != address(0));
        makerDaoContract = daoContract;
    }

    function setKyberNetworkAddress(address _kyberNetwork) public onlyAdmin{
        require(_kyberNetwork != address(0));
        kyberNetwork = _kyberNetwork;
    }

    function setMaxBlockDrift(uint numBlocks) public onlyAdmin {
        require(numBlocks > 1);
        maxBlockDrift = numBlocks;
    }

    function setBuyCommissionBps(uint commission) public onlyAdmin {
        require(commission < 10000);
        buyCommissionBps = commission;
    }

    function setSellCommissionBps(uint commission) public onlyAdmin {
        require(commission < 10000);
        sellCommissionBps = commission;
    }

    function encodePriceFeed(uint blockNumber, uint nonce, uint ask, uint bid) internal pure returns(uint) {
        // check overflows
        require(blockNumber < POW_2_64);
        require(nonce < POW_2_64);
        require(ask < POW_2_64);
        require(bid < POW_2_64);

        // do encoding
        uint result = blockNumber;
        result |= nonce * POW_2_64;
        result |= ask * POW_2_64 * POW_2_64;
        result |= bid * POW_2_64 * POW_2_64 * POW_2_64;

        return result;
    }

    function decodePriceFeed(uint input) internal pure returns(uint blockNumber, uint nonce, uint ask, uint bid) {
        blockNumber = uint(uint64(input));
        nonce = uint(uint64(input / POW_2_64));
        ask = uint(uint64(input / (POW_2_64 * POW_2_64)));
        bid = uint(uint64(input / (POW_2_64 * POW_2_64 * POW_2_64)));
    }

    function getBalance(ERC20 token) public view returns(uint) {
        if (token == ETH_TOKEN_ADDRESS)
            return this.balance;
        else
            return token.balanceOf(this);
    }

    function getDestQty(ERC20 src, ERC20 dest, uint srcQty, uint rate) public view returns(uint) {
        uint dstDecimals = getDecimals(dest);
        uint srcDecimals = getDecimals(src);
        return calcDstQty(srcQty, srcDecimals, dstDecimals, rate);
    }
}
