const TestToken = artifacts.require("./mockContracts/TestToken.sol");
const TestFeeToken = artifacts.require("./mockContracts/TestFeeToken.sol");
const MockMakerDao = artifacts.require("./mockContracts/MockMakerDao.sol");
const DigixReserve = artifacts.require("./DigixReserve.sol");
const WhiteList = artifacts.require("./WhiteList.sol");
const ExpectedRate = artifacts.require("./ExpectedRate.sol");
const FeeBurner = artifacts.require("./FeeBurner.sol");
const KyberNetwork = artifacts.require("./KyberNetwork.sol");
const EcVerify = artifacts.require("./ECVerifyContract");
const Helper = require("./helper.js")
const ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const BigNumber = require('bignumber.js');

let gasPrice = (new BigNumber(10).pow(9).mul(50));
let digixReserve;
let makerDao;
let mockKyberNetwork;
let network;
let kncToken;
let whiteList;

let admin;
let operator;
let user1;
let user2;

const precisionPartial = new BigNumber(10).pow(15);
const precision = new BigNumber(10).pow(18);
const DGX_DECIMALS = new BigNumber(10).pow(9);
const maxDriftBlocks = 200;
const dollarsPerEtherWei = new BigNumber('0x14b3e478decdbdc000');
const digixFee = (new BigNumber(9987)).div(10000);

//signed values
const ask1000Digix = 48165;
const bid1000Digix = 50111;
const nonce = 256657;
const signatureBlock = 7;
const signerAddress = '0xA5d2ffD4C4C8d10b1F42144281aF033Abb1858bf';
const v = 0x1b;
const r = new BigNumber('0xb8e8db9cbdd7158d94193bbe715038d7bf9d68ae09f82a121de1dd66e342db52');
const s = new BigNumber('0x5d55882a58d634adb3245ad6333d8a059c5168964c51ceed6315326de0701082');

//balances
let digixReserveBalanceWei = new BigNumber(10).pow(19); //10^18 is one
let digixReserveBalanceTwei = new BigNumber(10).pow(10); //10^9 is one

contract('DigixReserve', function (accounts) {
    it("create Digix token and Reserve, move funds.", async function (){
        admin = accounts[0];
        operator = accounts[1];
        user1 = accounts[2];
        user2 = accounts[3]
        mockKyberNetwork = accounts[4];

        if ((await web3.eth.blockNumber) < 3) {
            let accountEther = 80;
            await Helper.sendEtherWithPromise(accounts[3], accounts[1], accountEther)
            await Helper.sendEtherWithPromise(accounts[4], accounts[1], accountEther)
            await Helper.sendEtherWithPromise(accounts[5], accounts[1], accountEther)
            await Helper.sendEtherWithPromise(accounts[6], accounts[1], accountEther)
            await Helper.sendEtherWithPromise(accounts[7], accounts[1], accountEther)
            await Helper.sendEtherWithPromise(accounts[8], accounts[1], accountEther)
        }

        // create dgx token.
        digix = await TestFeeToken.new("dex dgx token", "digix", 9);

        // create makerDao
        makerDao = await MockMakerDao.new();
        await makerDao.setDollarsPerEtherWei(dollarsPerEtherWei);

        //create reserve
        digixReserve = await DigixReserve.new(admin, mockKyberNetwork, digix.address);
        await digixReserve.addOperator(operator);
        await digixReserve.addOperator(signerAddress);
        await digixReserve.setMakerDaoContract(makerDao.address);

        // transfer tokens and ethers to digix Reserve.
        await digix.transfer(digixReserve.address, digixReserveBalanceTwei);
        await Helper.sendEtherWithPromise(accounts[1], digixReserve.address, digixReserveBalanceWei)

        //create network
        network = await KyberNetwork.new(admin);

         // add reserves
        await network.addReserve(digixReserve.address, true);

        //add network and all related contracts
        let kncToken = await TestToken.new("kyber", "KNC", 18);
        feeBurner = await FeeBurner.new(admin, kncToken.address, network.address);
        let kgtToken = await TestToken.new("kyber genesis token", "KGT", 0);
        whiteList = await WhiteList.new(admin, kgtToken.address);
        await whiteList.addOperator(operator);
        await whiteList.setCategoryCap(0, 5000, {from:operator});
        await whiteList.setSgdToEthRate(850000000000000, {from:operator});

        expectedRate = await ExpectedRate.new(network.address, admin);

        let negligibleRateDiff = 15;
        await network.setParams(whiteList.address, expectedRate.address, feeBurner.address, gasPrice.valueOf(), negligibleRateDiff);
        await network.setEnable(true);

        //list digix
        await network.listPairForReserve(digixReserve.address, ethAddress, digix.address, true);
        await network.listPairForReserve(digixReserve.address, digix.address, ethAddress, true);
    });

    it("add price feed and get values - verify matching.", async function (){
        await digixReserve.setPriceFeed(signatureBlock, nonce, ask1000Digix, bid1000Digix, v, r, s);
        let lastFeedValues = await digixReserve.getPriceFeed();
//        console.log(lastFeedValues);

        assert.equal(lastFeedValues[0].valueOf(), signatureBlock);
        assert.equal(lastFeedValues[1].valueOf(), nonce);
        assert.equal(lastFeedValues[2].valueOf(), ask1000Digix);
        assert.equal(lastFeedValues[3].valueOf(), bid1000Digix);
    });

    it("get conversion rate ether to digix and verify correct.", async function (){
        let block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        //calculate expected rate ether to digix == ether dollar price / digix dollar price
        let ethDollarValue = (new BigNumber(dollarsPerEtherWei)).div((new BigNumber(10)).pow(18));
        let digixDollarValue = (new BigNumber(ask1000Digix)).div(new BigNumber(1000));
        let expectedRate = (ethDollarValue.div(digixDollarValue)) / 1;


        let rxRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQty, block);
        rxRate = new BigNumber(rxRate.valueOf());
        rxRate = (rxRate.div(precisionPartial)).valueOf() / 1000;

        assert.equal(rxRate.toFixed(9), expectedRate.toFixed(9), "bad conversion rate");
    })

    it("get conversion rate digix to ether and verify correct.", async function (){
        let block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        //calculate expected rate digix to ether == digix dollar price / ether dollar price
        let ethDollarValue = (new BigNumber(dollarsPerEtherWei)).div((new BigNumber(10)).pow(18));
        let digixDollarValue = (new BigNumber(bid1000Digix)).div(new BigNumber(1000));
        let expectedRate = (digixDollarValue.div(ethDollarValue)) / 1;

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQty, block);
        rxRate = new BigNumber(rxRate.valueOf());
        rxRate = (rxRate.div(precisionPartial)).valueOf() / 1000;

        assert.equal(rxRate.toFixed(9), expectedRate.toFixed(9), "bad conversion rate");
    })

    it("buy digix. (ether to digix)", async function (){
        let block = await web3.eth.blockNumber;
        let srcQtyWei = 1000000000000;

        let rxRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQtyWei, block);
        let rate = new BigNumber(rxRate.valueOf());

        //calculate expected dest qty
        //(srcQty * rate) / (PRECISION * (10**(srcDecimals - dstDecimals)))

        let divBy = precision.mul(new BigNumber(10).pow(18-9));
        let expectedDstQty = rate.mul(srcQtyWei).div(divBy);
        //need to follow full truffle calculations since each one causes more rounding down...
        expectedDstQty = expectedDstQty.floor();
        expectedDstQty = expectedDstQty.mul(10000).div(9987);
        expectedDstQty = expectedDstQty.floor()
        expectedDstQty = expectedDstQty.mul(9987).div(10000);
        expectedDstQty = expectedDstQty.add(1).floor()

//        trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)

        await digixReserve.trade(ethAddress, srcQtyWei, digix.address, user2, rxRate, false, {from: mockKyberNetwork, value: srcQtyWei});
        let user2Balance = await digix.balanceOf(user2);
        assert.equal(user2Balance.valueOf(), expectedDstQty.valueOf(), "wrong balance user2");
    })

    it("sell back digix", async function (){
        let block = await web3.eth.blockNumber;
        let srcQtyDigixTwei = await digix.balanceOf(user2);
        let digixApproveValue = 2 * srcQtyDigixTwei.valueOf();

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQtyDigixTwei.valueOf(), block);
        let rate = new BigNumber(rxRate.valueOf());

        //calculate expected dest qty
        //here dstDecimals > src decimals
        //dstQty = (srcQty * rate * (10**(dstDecimals - srcDecimals))) / PRECISION;

        let dstQty = rate.mul(srcQtyDigixTwei).mul((new BigNumber(10)).pow(18-9)).div(precision);
        dstQty = dstQty.floor();
        console.log('dstQty.valueOf()')
        console.log(dstQty.valueOf())

//        trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)

        let user2StartBalanceWei = await Helper.getBalancePromise(user2);

        digix.transfer(mockKyberNetwork, digixApproveValue);
        digix.approve(digixReserve.address, digixApproveValue, {from: mockKyberNetwork});

        await digixReserve.trade(digix.address, srcQtyDigixTwei, ethAddress, user2, rxRate, false, {from: mockKyberNetwork});
        let user2BalanceWei = await Helper.getBalancePromise(user2);
        let actualWeiQty = user2BalanceWei - user2StartBalanceWei;
        assert.equal(actualWeiQty, dstQty.valueOf(), "wrong balance user2")
    });

    it("get from reserve conversion rate ether to digix. compare to network result.", async function (){
        let block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        let reserveRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQty, block);

        let networkRate = await network.findBestRate(ethAddress, digix.address, srcQty);

        assert.equal(reserveRate.valueOf(), networkRate[1].valueOf(), "reserve rate and network rate don't match")
    })

    it("get from reserve conversion rate digix to ether. compare to network result.", async function (){
        let block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        let reserveRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQty, block);

        let networkRate = await network.findBestRate(digix.address, ethAddress, srcQty);

        assert.equal(reserveRate.valueOf(), networkRate[1].valueOf(), "reserve rate and network rate don't match")
    })


    it("buy digix. (ether to digix). use network", async function (){
        let block = await web3.eth.blockNumber;
        let srcQtyWei = 10000000000;

        let rxRate = await network.findBestRate(ethAddress, digix.address, srcQtyWei);
        let rate = new BigNumber(rxRate[1].valueOf());

        //calculate expected dest qty
        //(srcQty * rate) / (PRECISION * (10**(srcDecimals - dstDecimals)))

        let divBy = precision.mul(new BigNumber(10).pow(18-9));
        let expectedDstQty = rate.mul(srcQtyWei).div(divBy);
        //need to follow full truffle calculations since each one causes more rounding down...
        //first - reserve to network
        expectedDstQty = expectedDstQty.floor();
        expectedDstQty = expectedDstQty.mul(10000).div(9987);
        expectedDstQty = expectedDstQty.floor()
        expectedDstQty = expectedDstQty.mul(9987).div(10000);
        expectedDstQty = expectedDstQty.floor()

        //now network to user. will get less 0.13%
        expectedDstQty = expectedDstQty.mul(9987).div(10000);
        expectedDstQty = expectedDstQty.add(1).floor();

        //trade(ERC20 src, uint srcAmount, ERC20 dest, destAddress, maxDestAmount, uint minConversionRate, address walletId
        let maxDestAmount = 1000000;
        let user2StartBalance = await digix.balanceOf(user2);

        // set real network in digixReserve
        await digixReserve.setKyberNetworkAddress(network.address);

        await network.trade(ethAddress, srcQtyWei, digix.address, user2, maxDestAmount, rxRate - 10, 0, {from:user1, value: srcQtyWei});
        let user2Balance = await digix.balanceOf(user2);
        let recievedDigix = user2Balance - user2StartBalance;
        assert.equal(recievedDigix.valueOf(), expectedDstQty.valueOf(), "wrong balance user2");
    })

          //digix has 0.13% fees. the internal transaction reserve to user looses those fees.
//            expectedDstQty = expectedDstQty.mul(9987).div(10000);


});


async function threeStringsSoliditySha(str1, str2, str3) {
    let str1Cut = str1.slice(2);
    let str2Cut = str2.slice(2);
    let str3Cut = str3.slice(2);
    let combinedSTR = str1Cut + str2Cut + str3Cut;

    // Convert a string to a byte array
    for (var bytes = [], c = 0; c < combinedSTR.length; c += 2)
        bytes.push(parseInt(combinedSTR.substr(c, 2), 16));

    let sha3Res = await web3.utils.sha3(bytes);
    return sha3Res;
};
