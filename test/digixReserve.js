const TestToken = artifacts.require("./mockContracts/TestToken.sol");
const MockMakerDao = artifacts.require("./mockContracts/MockMakerDao.sol");
const DigixReserve = artifacts.require("./DigixReserve.sol");
const EcVerify = artifacts.require("./ECVerifyContract");
const Helper = require("./helper.js")
const ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const BigNumber = require('bignumber.js');
//const elliptic = require('elliptic');
//const secp256k1 = new (elliptic.ec)('secp256k1'); // eslint-disable-line


let digixReserve;
let makerDao;
let mockKyberNetwork;
let admin;
let operator;
let user1;
let user2;
let nonce = 7253;

const precisionPartial = new BigNumber(10).pow(15);
const precision = new BigNumber(10).pow(18);
const DGX_DECIMALS = new BigNumber(10).pow(9);
const maxDriftBlocks = 200;
const weiPerDollar = new BigNumber('0x14b3e478decdbdc000');
const ask1000Digix = 48165;
const bid1000Digix = 50111;

//balances
let digixReserveBalanceWei = new BigNumber(10).pow(19); //10^18 is one
let digixReserveBalanceTwei = new BigNumber(10).pow(10); //10^9 is one

contract('DigixReserve', function (accounts) {
    it("create Digix toekn and Reserve, move funds.", async function (){
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
        digix = await TestToken.new("dex dgx token", "digix", 9);

        // create makerDao
        makerDao = await MockMakerDao.new();
        console.log('weiPerDollar')
        console.log(weiPerDollar.valueOf())
        await makerDao.setWeiPerDollarRate(weiPerDollar);

        //create reserve
        digixReserve = await DigixReserve.new(admin, mockKyberNetwork, digix.address);
        await digixReserve.addOperator(operator);
        await digixReserve.setMakerDaoContract(makerDao.address);

        // transfer tokens and ethers to digix Reserve.
        await digix.transfer(digixReserve.address, digixReserveBalanceTwei);
        await Helper.sendEtherWithPromise(accounts[1], digixReserve.address, digixReserveBalanceWei)
    });

    it("add price feed and get values - verify matching.", async function (){
        let blockNumber = await web3.eth.blockNumber;
        let signature = "0xe11c7e420ad1042fb6233562a004427ab34ce1389a1fb76c4daeb50f49b2172d66fb50c255b7faaed4b017fb364d30f1566b030d099f17a94c9618afae7d2e6400";

        nonce++;

        await digixReserve.addPriceFeed(blockNumber, nonce, ask1000Digix, bid1000Digix, signature);
        let lastFeedValues = await digixReserve.getLastPriceFeedValues();
//        console.log(lastFeedValues);

        assert.equal(lastFeedValues[0].valueOf(), blockNumber);
        assert.equal(lastFeedValues[1].valueOf(), nonce);
        assert.equal(lastFeedValues[2].valueOf(), ask1000Digix);
        assert.equal(lastFeedValues[3].valueOf(), bid1000Digix);
    });

    it("get conversion rate buy digix.", async function (){
        let block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        let rxRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQty, block);

        let rate = new BigNumber(rxRate.valueOf());

        let ratePerEth = (rate.div(precisionPartial)).valueOf() / 1000;
        console.log('ratePerEth');
        console.log(ratePerEth);
        assert(ratePerEth > 0.126 && ratePerEth < 0.127, "bad conversion rate");
    })

    it("get conversion rate sell digix.", async function (){
        let block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQty, block);

        let rate = new BigNumber(rxRate.valueOf());

        let ratePerEth = (rate.div(precisionPartial)).valueOf() / 1000;
        console.log('ratePerEth');
        console.log(ratePerEth);
    })

    it("buy digix", async function (){
        let block = await web3.eth.blockNumber;
        let srcQtyWei = 1000000000000;

        let rxRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQtyWei, block);

        console.log('rxRate')
        console.log(rxRate.valueOf());

        let rate = new BigNumber(rxRate.valueOf());

        //calculate expected dest qty
        //(srcQty * rate) / (PRECISION * (10**(srcDecimals - dstDecimals)))

        let divBy = precision.mul(new BigNumber(10).pow(18-9));
        let dstQty = rate.mul(srcQtyWei).div(divBy);
        dstQty = dstQty.floor();
        console.log('dstQty.valueOf()')
        console.log(dstQty.valueOf())

        let ratePerEth = (rate.div(precisionPartial)).valueOf() / 1000;
        console.log('ratePerEth');
        console.log(ratePerEth);

//        trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)

        await digixReserve.trade(ethAddress, srcQtyWei, digix.address, user2, rxRate, false, {from: mockKyberNetwork, value: srcQtyWei});
        let user2Balance = await digix.balanceOf(user2);
        assert.equal(user2Balance.valueOf(), dstQty.valueOf(), "wrong balance user2");
    })

    it("sell back digix", async function (){
        let block = await web3.eth.blockNumber;
        let srcQtyDigixTwei = await digix.balanceOf(user2);
        let digixApproveValue = 2 * srcQtyDigixTwei.valueOf();

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQtyDigixTwei.valueOf(), block);

        let rate = new BigNumber(rxRate.valueOf());

        console.log('srcQtyDigixTwei')
        console.log(srcQtyDigixTwei.valueOf())

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
    })
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
