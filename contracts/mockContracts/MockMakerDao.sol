pragma solidity ^0.4.18;

contract MockMakerDao {
    bytes32 public dollarPerEther; //dollar price of 1 ether * 10**18
    bool isRateValid = true;

    function peek() constant returns (bytes32, bool) {
        return (dollarPerEther, isRateValid);
    }

    function setDollarsPerEtherWei(uint _dollarPerEther) public {
        dollarPerEther = bytes32(_dollarPerEther);
    }

    function setIsRateValid (bool isValid) public {
        isRateValid = isValid;
    }
}
