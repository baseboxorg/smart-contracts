pragma solidity 0.4.18;


import "./ERC20Interface.sol";
import "./Utils.sol";
import "./Withdrawable.sol";
import "./ConversionRatesInterface.sol";
import "./SanityRatesInterface.sol";
import "./KyberReserveInterface.sol";


interface MakerDao {
    function peek() public view returns (bytes32, bool);
}


contract DigixReserve is KyberReserveInterface, Withdrawable, Utils {

    ERC20 public digix;
    MakerDao public makerDaoContract;
    ConversionRatesInterface public conversionRatesContract;
    SanityRatesInterface public sanityRatesContract;
    address public kyberNetwork;
    uint public maxBlockDrift = 300; //Max drift from block that price feed was received till we can't use it.
    bool public tradeEnabled;
    uint public buyTransferFee = 13; //Digix token has transaction fees we should compensate for our flow to work
    uint public sellTransferFee = 13;
    mapping(bytes32=>bool) public approvedWithdrawAddresses; // sha3(token,address)=>bool
    uint internal priceFeed;  //all price feed data squinted to one uint256
    uint constant internal POW_2_64 = 2 ** 64;

    function DigixReserve(address _admin, address _kyberNetwork, ERC20 _digix) public {
        require(_admin != address(0));
        require(_digix != address(0));
        require(_kyberNetwork != address(0));
        admin = _admin;
        digix = _digix;
        setDecimals(digix);
        kyberNetwork = _kyberNetwork;
        sanityRatesContract = SanityRatesInterface(0);
        conversionRatesContract = ConversionRatesInterface(0x901d);
        tradeEnabled = true;
    }

    function () public payable {} // solhint-disable-line no-empty-blocks

    /// @dev Add digix price feed. Valid for @maxBlockDrift blocks
    /// @param blockNumber the block this price feed was signed.
    /// @param nonce the nonce with which this block was signed.
    /// @param ask1KDigix ask price dollars per Kg gold == 1000 digix
    /// @param bid1KDigix bid price dollars per KG gold == 1000 digix
    /// @param v - v part of signature of keccak 256 hash of (block, nonce, ask, bid)
    /// @param r - r part of signature of keccak 256 hash of (block, nonce, ask, bid)
    /// @param s - s part of signature of keccak 256 hash of (block, nonce, ask, bid)
    function setPriceFeed(
        uint blockNumber,
        uint nonce,
        uint ask1KDigix,
        uint bid1KDigix,
        uint8 v,
        bytes32 r,
        bytes32 s
        ) public
    {
        uint prevFeedBlock;
        uint prevNonce;
        uint prevAsk;
        uint prevBid;

        (prevFeedBlock, prevNonce, prevAsk, prevBid) = getPriceFeed();
        require(nonce > prevNonce);
        require(blockNumber + maxBlockDrift > block.number);
        require(blockNumber <= block.number);

        require(verifySignature(keccak256(blockNumber, nonce, ask1KDigix, bid1KDigix), v, r, s));

        priceFeed = encodePriceFeed(blockNumber, nonce, ask1KDigix, bid1KDigix);
    }

    /* solhint-disable code-complexity */
    function getConversionRate(ERC20 src, ERC20 dest, uint srcQty, uint blockNumber) public view returns(uint) {
        if (!tradeEnabled) return 0;
        if (makerDaoContract == MakerDao(0)) return 0;
        uint feedBlock;
        uint nonce;
        uint ask1KDigix;
        uint bid1KDigix;
        blockNumber;

        (feedBlock, nonce, ask1KDigix, bid1KDigix) = getPriceFeed();
        if (feedBlock + maxBlockDrift <= block.number) return 0;

        // wei per dollar from makerDao
        bool isRateValid;
        bytes32 dollarsPerEtherWei; //price in dollars of 1 Ether * 10**18
        (dollarsPerEtherWei, isRateValid) = makerDaoContract.peek();
        if (!isRateValid || uint(dollarsPerEtherWei) > MAX_RATE) return 0;

        uint rate;
        if (ETH_TOKEN_ADDRESS == src && digix == dest) {
            //buy digix with ether == sell ether
            if (ask1KDigix == 0) return 0;
            //rate = (ether $ price / digix $ price) * precision
            //rate = ((dollarsPerEtherWei / etherwei == 10**18) / (bid1KDigix / 1000)) * PRECISION
            rate = 1000 * uint(dollarsPerEtherWei) / ask1KDigix;
        } else if (digix == src && ETH_TOKEN_ADDRESS == dest) {
            //sell digix == buy ether with digix
            //rate = (digix $ price / ether $ price) * precision
            //rate = ((bid1KDigix / 1000) / (dollarsPerEtherWei / etherwei == 10**18)) * PRECISION
            rate = bid1KDigix * PRECISION * PRECISION / uint(dollarsPerEtherWei) / 1000;
        } else {
            return 0;
        }

        if (rate > MAX_RATE) return 0;

        uint destQty = getDestQty(src, dest, srcQty, rate);
        if (getBalance(dest) < destQty) return 0;

        return rate;
    }
    /* solhint-enable code-complexity */

    function getPriceFeed() public view returns(uint feedBlock, uint nonce, uint ask1KDigix, uint bid1KDigix) {
        (feedBlock, nonce, ask1KDigix, bid1KDigix) = decodePriceFeed(priceFeed);
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
            if (srcToken == ETH_TOKEN_ADDRESS) {
                require(msg.value == srcAmount);
                require(ERC20(destToken) == digix);
            } else {
                require(ERC20(srcToken) == digix);
                require(msg.value == 0);
            }
        }

        uint destAmount = getDestQty(srcToken, destToken, srcAmount, conversionRate);
        uint adjustedAmount;
        // sanity check
        require(destAmount > 0);

        // collect src tokens
        if (srcToken != ETH_TOKEN_ADDRESS) {
            //due to fee network has less tokens. take amount less fee. reduce 1 to avoid rounding errors.
            adjustedAmount = (srcAmount * (10000 - sellTransferFee) / 10000) - 1;
            require(srcToken.transferFrom(msg.sender, this, adjustedAmount));
        }

        // send dest tokens
        if (destToken == ETH_TOKEN_ADDRESS) {
            destAddress.transfer(destAmount);
        } else {
            //add 1 to compensate for rounding errors.
            adjustedAmount = (destAmount * 10000 / (10000 - buyTransferFee)) + 1;
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

    function setMakerDaoContract(MakerDao daoContract) public onlyAdmin {
        require(daoContract != address(0));
        makerDaoContract = daoContract;
    }

    function setKyberNetworkAddress(address _kyberNetwork) public onlyAdmin {
        require(_kyberNetwork != address(0));
        kyberNetwork = _kyberNetwork;
    }

    function setMaxBlockDrift(uint numBlocks) public onlyAdmin {
        require(numBlocks > 1);
        maxBlockDrift = numBlocks;
    }

    function setBuyFeeBps(uint fee) public onlyAdmin {
        require(fee < 10000);
        buyTransferFee = fee;
    }

    function setSellFeeBps(uint fee) public onlyAdmin {
        require(fee < 10000);
        sellTransferFee = fee;
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

    function decodePriceFeed(uint input) internal pure returns(uint blockNumber, uint nonce, uint ask, uint bid) {
        blockNumber = uint(uint64(input));
        nonce = uint(uint64(input / POW_2_64));
        ask = uint(uint64(input / (POW_2_64 * POW_2_64)));
        bid = uint(uint64(input / (POW_2_64 * POW_2_64 * POW_2_64)));
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

    function verifySignature(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal view returns(bool) {
        address signer = ecrecover(hash, v, r, s);
        return operators[signer];
    }
}
