pragma solidity ^0.4.18;

contract MockMakerDao {
    bytes32 public weiPerDollar;
    bool isRateValid = true;

    function peek() constant returns (bytes32, bool) {
        return (weiPerDollar, isRateValid);
    }

    function setWeiPerDollarRate(uint _weiPerDollar) public {
        weiPerDollar = bytes32(_weiPerDollar);
    }

    function setIsRateValid (bool isValid) public {
        isRateValid = isValid;
    }
}
