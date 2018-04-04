const TestToken = artifacts.require("./mockContracts/TestToken.sol");
const TestFeeToken = artifacts.require("./mockContracts/TestFeeToken.sol");
const MockMakerDao = artifacts.require("./mockContracts/MockMakerDao.sol");
const DigixReserve = artifacts.require("./DigixReserve.sol");
const WhiteList = artifacts.require("./WhiteList.sol");
const ExpectedRate = artifacts.require("./ExpectedRate.sol");
const FeeBurner = artifacts.require("./FeeBurner.sol");
const KyberNetwork = artifacts.require("./KyberNetwork.sol");
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
let alerter;

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
        alerter = accounts[5];

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
        await digixReserve.addAlerter(alerter);
        await digixReserve.setMakerDaoContract(makerDao.address);

        // transfer tokens and ethers to digix Reserve.
        await digix.transfer(digixReserve.address, digixReserveBalanceTwei);
        await Helper.sendEtherWithPromise(accounts[1], digixReserve.address, digixReserveBalanceWei);

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

    it("tests when ask 1k digix is 0, get rate returns 0.", async function (){
        const block = await web3.eth.blockNumber;
        let rxRate = await digixReserve.getConversionRate(ethAddress, digix.address, 5, block);
        assert.equal(rxRate.valueOf(), 0);
    });

    it("tests get balance for reserve.", async function (){
        let reserveWei = await digixReserve.getBalance(ethAddress);
        assert.equal(reserveWei.valueOf(), digixReserveBalanceWei.valueOf(), "reserve balance not as expected");

        let reserveTwei = await digixReserve.getBalance(digix.address);
        let expectedBalanceTwei = (new BigNumber(digixReserveBalanceTwei)).mul(9987).div(10000);
        assert.equal(reserveTwei.valueOf(), expectedBalanceTwei.valueOf(), "reserve balance not as expected");
    });

    it("add price feed and get values - verify matching.", async function (){
        await digixReserve.setPriceFeed(signatureBlock, nonce, ask1000Digix, bid1000Digix, v, r, s);

        //see set price feed reverts on nonce <= prev nonce.
        try {
            await digixReserve.setPriceFeed(signatureBlock, nonce, ask1000Digix, bid1000Digix, v, r, s);
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        let lastFeedValues = await digixReserve.getPriceFeed();
//        console.log(lastFeedValues);

        assert.equal(lastFeedValues[0].valueOf(), signatureBlock);
        assert.equal(lastFeedValues[1].valueOf(), nonce);
        assert.equal(lastFeedValues[2].valueOf(), ask1000Digix);
        assert.equal(lastFeedValues[3].valueOf(), bid1000Digix);
    });

    it("get conversion rate ether to digix and verify correct.", async function (){
        const block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        //calculate expected rate ether to digix == ether dollar price / digix dollar price
        let ethDollarValue = (new BigNumber(dollarsPerEtherWei)).div((new BigNumber(10)).pow(18));
        let digixDollarValue = (new BigNumber(ask1000Digix)).div(new BigNumber(1000));
        let expectedRate = (ethDollarValue.div(digixDollarValue)) / 1;


        let rxRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQty, block);
        rxRate = new BigNumber(rxRate.valueOf());
        rxRate = (rxRate.div(precision)).valueOf() / 1;

        assert.equal(rxRate.toFixed(9), expectedRate.toFixed(9), "bad conversion rate");
    })

    it("get conversion rate digix to ether and verify correct.", async function (){
        const block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        //calculate expected rate digix to ether == digix dollar price / ether dollar price
        let ethDollarValue = (new BigNumber(dollarsPerEtherWei)).div((new BigNumber(10)).pow(18));
        let digixDollarValue = (new BigNumber(bid1000Digix)).div(new BigNumber(1000));
        let expectedRate = (digixDollarValue.div(ethDollarValue)) / 1;

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQty, block);
        rxRate = new BigNumber(rxRate.valueOf());
        rxRate = (rxRate.div(precision)).valueOf() / 1;

        assert.equal(rxRate.toFixed(9), expectedRate.toFixed(9), "bad conversion rate");
    })

    it("trade ether to digix. buy digix.", async function (){
        const block = await web3.eth.blockNumber;
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

//      api: trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)

        await digixReserve.trade(ethAddress, srcQtyWei, digix.address, user2, rxRate, false, {from: mockKyberNetwork, value: srcQtyWei});
        let user2Balance = await digix.balanceOf(user2);
        assert.equal(user2Balance.valueOf(), expectedDstQty.valueOf(), "wrong balance user2");
    })

    it("trade digix to ether", async function (){
        const block = await web3.eth.blockNumber;
        let srcQtyDigixTwei = await digix.balanceOf(user2);
        let digixApproveValue = 2 * srcQtyDigixTwei.valueOf();

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQtyDigixTwei.valueOf(), block);
        let rate = new BigNumber(rxRate.valueOf());
        //calculate expected dest qty
        //here dstDecimals > src decimals
        //dstQty = (srcQty * rate * (10**(dstDecimals - srcDecimals))) / PRECISION;
        let expectedDstQty = (rate.mul(srcQtyDigixTwei).mul((new BigNumber(10)).pow(9))).div(precision);
        expectedDstQty = expectedDstQty.floor();

        let user2StartBalanceWei = new BigNumber(await Helper.getBalancePromise(user2));

        digix.transfer(mockKyberNetwork, digixApproveValue);
        digix.approve(digixReserve.address, digixApproveValue, {from: mockKyberNetwork});


//      API:  trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)
        await digixReserve.trade(digix.address, srcQtyDigixTwei, ethAddress, user2, rate, true, {from: mockKyberNetwork});

        let user2BalanceWei = new BigNumber(await Helper.getBalancePromise(user2));
        let actualWeiQty = user2BalanceWei.sub(user2StartBalanceWei);
        assert.equal(actualWeiQty.valueOf(), expectedDstQty.valueOf(), "wrong balance user2")
    });

    it("get from reserve conversion rate ether to digix. compare to network result.", async function (){
        const block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        let reserveRate = await digixReserve.getConversionRate(ethAddress, digix.address, srcQty, block);

        let networkRate = await network.findBestRate(ethAddress, digix.address, srcQty);

        assert.equal(reserveRate.valueOf(), networkRate[1].valueOf(), "reserve rate and network rate don't match")
    })

    it("get from reserve conversion rate digix to ether. compare to network result.", async function (){
        const block = await web3.eth.blockNumber;
        let srcQty = 100; //has no affect in digix get rate

        let reserveRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQty, block);

        let networkRate = await network.findBestRate(digix.address, ethAddress, srcQty);

        assert.equal(reserveRate.valueOf(), networkRate[1].valueOf(), "reserve rate and network rate don't match")
    })

    it("trade ether to digix. (buy digix). use network", async function (){
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

        let maxDestAmount = 2 * expectedDstQty;
        let user2StartBalance = await digix.balanceOf(user2);

        // set real network in digixReserve
        await digixReserve.setKyberNetworkAddress(network.address);

        //API: trade(ERC20 src, uint srcAmount, ERC20 dest, destAddress, maxDestAmount, uint minConversionRate, address walletId
        await network.trade(ethAddress, srcQtyWei, digix.address, user2, maxDestAmount, rxRate - 10, 0, {from:user1, value: srcQtyWei});
        let user2Balance = await digix.balanceOf(user2);
        let recievedDigix = user2Balance - user2StartBalance;
        assert.equal(recievedDigix.valueOf(), expectedDstQty.valueOf(), "wrong balance user2");
    })

    it("trade digix to ether. (sell digix). use network", async function (){
        let srcQtyDigixTwei = await digix.balanceOf(user2);
        let digixApproveValue = 2 * srcQtyDigixTwei.valueOf();

        let rxRate = await network.findBestRate(digix.address, ethAddress, srcQtyDigixTwei);
        let rate = new BigNumber(rxRate[1].valueOf());

        //calculate expected dest qty
        //here dstDecimals > src decimals
        //dstQty = (srcQty * rate * (10**(dstDecimals - srcDecimals))) / PRECISION;
        let expectedDstQty = (rate.mul(srcQtyDigixTwei).mul((new BigNumber(10)).pow(9))).div(precision);
        expectedDstQty = expectedDstQty.floor();

        let user2StartBalanceWei = new BigNumber(await Helper.getBalancePromise(user2));

        digix.transfer(user1, digixApproveValue);
        digix.approve(network.address, digixApproveValue, {from: user1});
        let maxDestAmount = 2 * expectedDstQty;

        //API: trade(ERC20 src, uint srcAmount, ERC20 dest, destAddress, maxDestAmount, uint minConversionRate, address walletId
        await network.trade(digix.address, srcQtyDigixTwei, ethAddress, user2, maxDestAmount, rxRate - 10, 0, {from:user1});
        let user2BalanceWei = new BigNumber(await Helper.getBalancePromise(user2));
        let actualWeiQty = user2BalanceWei.sub(user2StartBalanceWei);
        assert.equal(actualWeiQty.valueOf(), expectedDstQty.valueOf(), "wrong balance user2")
    })

    it("verify set kyber network possible only with admin account", async function (){
        try {
             await digixReserve.setKyberNetworkAddress(mockKyberNetwork, {from: operator});
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }
        let kyberNetwork = await digixReserve.kyberNetwork();
        assert(kyberNetwork.valueOf() != mockKyberNetwork);
        await digixReserve.setKyberNetworkAddress(mockKyberNetwork, {from: admin});
        kyberNetwork = await digixReserve.kyberNetwork();
        assert(kyberNetwork.valueOf() == mockKyberNetwork);
    })

    it("verify set maker dao contract address possible only with admin account", async function (){
        try {
             await digixReserve.setMakerDaoContract(mockKyberNetwork, {from: operator});
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }
        let maker = await digixReserve.makerDaoContract();
        assert(maker.valueOf() != mockKyberNetwork);
        await digixReserve.setMakerDaoContract(mockKyberNetwork, {from: admin});
        maker = await digixReserve.makerDaoContract();
        assert(maker.valueOf() == mockKyberNetwork);
        //set back correct makder DAO
        await digixReserve.setMakerDaoContract(makerDao.address, {from: admin});
    })

    it("approve withdraw address and withdraw funds. ether and digix", async function (){
        await digixReserve.approveWithdrawAddress(ethAddress, user2, true, {from: admin});
        await digixReserve.approveWithdrawAddress(digix.address, user2, true, {from: admin});

        //withdraw ether.
        let weiSendAmount = 10;
        let user2StartBalanceWei = new BigNumber(await Helper.getBalancePromise(user2));
        await digixReserve.withdraw(ethAddress, weiSendAmount, user2, {from: operator});
        let user2BalanceWei = new BigNumber(await Helper.getBalancePromise(user2));
        let balanceDiff = user2BalanceWei.sub(user2StartBalanceWei);
        assert.equal(balanceDiff.valueOf(), weiSendAmount);

        //withdraw ether.
        let tweiSendAmount = 10;
        let user2StartBalanceTwei = new BigNumber(await digix.balanceOf(user2));
        await digixReserve.withdraw(digix.address, weiSendAmount, user2, {from: operator});
        let user2BalanceTwei = new BigNumber(await digix.balanceOf(user2));
        balanceDiff = user2BalanceTwei.sub(user2StartBalanceTwei);
        let amountMinusFee = (new BigNumber(tweiSendAmount)).mul(9987).div(10000).floor();
        assert.equal(balanceDiff.valueOf(), amountMinusFee.valueOf());
    })

    it("verify approve withdraw funds only by admin and withdraw only by operator", async function (){
        let amount = 10;
        let reserveStartBalanceTwei = await digix.balanceOf(digixReserve.address);
        let reserveStartBalanceWei = await Helper.getBalancePromise(digixReserve.address);

        try {
            await digixReserve.approveWithdrawAddress(ethAddress, user1, true, {from: user1});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //see can't withdraw ether to user1.
        try {
            await digixReserve.withdraw(ethAddress, amount, user1, {from: operator});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //see can't withdraw ether to user2 by address different then operator
        try {
            await digixReserve.withdraw(ethAddress, amount, user2, {from: user2});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        let reserveBalanceTwei = await digix.balanceOf(digixReserve.address);
        let reserveBalanceWei = await Helper.getBalancePromise(digixReserve.address);
        assert.equal(reserveBalanceTwei.valueOf(), reserveStartBalanceTwei.valueOf());
        assert.equal(reserveBalanceWei.valueOf(), reserveStartBalanceWei.valueOf());
    })

    it("verify set price feed reverts for block number > current block number", async function (){
        const blockT = 700000;
        const nonceT = 256660;
        const askT = 48100;
        const bidT = 50115;
        const vT = 0x1c;
        const rT = new BigNumber('0x0fc3dfb2f04de2cc9813890192bbe018a462e9b0fc8656527a2e1b549b341441');
        const sT = new BigNumber('0x23b9c9b2f16adff5e71796809a8183a82c84b86f4295d6f32d0efbbec3f85e14');

        try {
             await digixReserve.setPriceFeed(blockT, nonceT, askT, bidT, vT, rT, sT);
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //see values haven't changed
        let lastFeedValues = await digixReserve.getPriceFeed();

        assert.equal(lastFeedValues[0].valueOf(), signatureBlock);
        assert.equal(lastFeedValues[1].valueOf(), nonce);
        assert.equal(lastFeedValues[2].valueOf(), ask1000Digix);
        assert.equal(lastFeedValues[3].valueOf(), bid1000Digix);
    })

    it("verify set price feed reverts when block number + blockdrift <= current block number", async function (){
        const blockT = 1;
        const nonceT = 256660;
        const askT = 48100;
        const bidT = 50115;
        const vT = 0x1b;
        const rT = new BigNumber('0xc3112880686177d8586cb0133ebbed8d73f6f756e432760ddc2c3390408e9fbb');
        const sT = new BigNumber('0x0c82007ad6107ea6ddd6fefdb9942bbe1a0082036fdc6fbc3716ebe926e535be');

        // for this test should set low block drift value
        await digixReserve.setMaxBlockDrift(2, {from: admin});

        try {
             await digixReserve.setPriceFeed(blockT, nonceT, askT, bidT, vT, rT, sT);
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //see values haven't changed
        let lastFeedValues = await digixReserve.getPriceFeed();

        assert.equal(lastFeedValues[0].valueOf(), signatureBlock);
        assert.equal(lastFeedValues[1].valueOf(), nonce);
        assert.equal(lastFeedValues[2].valueOf(), ask1000Digix);
        assert.equal(lastFeedValues[3].valueOf(), bid1000Digix);


        //set back block drift
        await digixReserve.setMaxBlockDrift(700, {from: admin});
    })

    it("verify set price feed reverts when signature doesn't match", async function (){
        try {
             await digixReserve.setPriceFeed(signatureBlock, (nonce + 1 * 1), ask1000Digix, bid1000Digix, v, r, s);
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }
    })


    it("verify only alerter can disable trade and only admin can enable trade", async function (){
        let tradeEnabled = await digixReserve.tradeEnabled();
        assert.equal(tradeEnabled, true);

        try {
             await digixReserve.disableTrade({from: operator});
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        tradeEnabled = await digixReserve.tradeEnabled();
        assert.equal(tradeEnabled, true);

        //now disable and verify
        await digixReserve.disableTrade({from: alerter});
        tradeEnabled = await digixReserve.tradeEnabled();
        assert.equal(tradeEnabled, false);

        //see enable fails with operator
        try {
             await digixReserve.enableTrade({from: operator});
             assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }
        tradeEnabled = await digixReserve.tradeEnabled();
        assert.equal(tradeEnabled, false);

        await digixReserve.enableTrade({from: admin});
        tradeEnabled = await digixReserve.tradeEnabled();
        assert.equal(tradeEnabled, true);
    })

    it("disable trade and verify 'get rate' is 0 and 'trade' reverted", async function (){
        let qty = 5;
        const block = await web3.eth.blockNumber;
        let goodRate = await digixReserve.getConversionRate(digix.address, ethAddress, qty, block);

        await digixReserve.disableTrade({from: alerter});

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, qty, block);
        assert.equal(rxRate.valueOf(), 0);

        try {
            await digixReserve.trade(digix.address, qty, ethAddress, user2, goodRate.valueOf(), true, {from: mockKyberNetwork});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        await digixReserve.enableTrade({from: admin});
    });

    it("tests set sell fee..", async function (){
        let newSellFee = 300;
        let normalSellFee = 13;
        await digixReserve.setSellFeeBps(newSellFee);
        let rxFee = await digixReserve.sellTransferFee();
        assert.equal(newSellFee, rxFee.valueOf());

        //make sure can't set above 9999
        let maxSellFee = 9999;
        await digixReserve.setSellFeeBps(maxSellFee);
        rxFee = await digixReserve.sellTransferFee();
        assert.equal(maxSellFee, rxFee.valueOf());

        try {
            await digixReserve.setSellFeeBps(maxSellFee * 1 + 1 * 1);
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        rxFee = await digixReserve.sellTransferFee();
        assert.equal(maxSellFee, rxFee.valueOf());

        //set back to normal
        await digixReserve.setSellFeeBps(normalSellFee);
        rxFee = await digixReserve.sellTransferFee();
        assert.equal(normalSellFee, rxFee.valueOf());
    });

    it("tests set buy fee..", async function (){
        let newBuyFee = 300;
        let normalBuyFee = 13;
        await digixReserve.setBuyFeeBps(newBuyFee);
        let rxFee = await digixReserve.buyTransferFee();
        assert.equal(newBuyFee, rxFee.valueOf());

        //make sure can't set above 9999
        let maxBuyFee = 9999;
        await digixReserve.setBuyFeeBps(maxBuyFee);
        rxFee = await digixReserve.buyTransferFee();
        assert.equal(maxBuyFee, rxFee.valueOf());

        try {
            await digixReserve.setBuyFeeBps(maxBuyFee * 1 + 1 * 1);
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        rxFee = await digixReserve.buyTransferFee();
        assert.equal(maxBuyFee, rxFee.valueOf());

        //set back to normal
        await digixReserve.setBuyFeeBps(normalBuyFee);
        rxFee = await digixReserve.buyTransferFee();
        assert.equal(normalBuyFee, rxFee.valueOf());
    });

    it("set low block drift. make sure rate returns 0 .", async function (){
        const block = await web3.eth.blockNumber;
        await digixReserve.setMaxBlockDrift(2, {from: admin});

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        //now set high block drift and see rate is ok
        await digixReserve.setMaxBlockDrift(700, {from: admin});

        rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert(rxRate.valueOf() > 0, "rate should be above zero");
    });

    it("set maker dao to return non valid rate flag. see our get rate returns 0", async function (){
        const block = await web3.eth.blockNumber;         
        await makerDao.setIsRateValid(false);

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        await makerDao.setIsRateValid(true);

        rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert(rxRate.valueOf() > 0, "rate should be above zero");
    })

    it("set maker dao to return rate > max rate. see our get rate returns 0", async function (){
        const block = await web3.eth.blockNumber;
        //
        const maxRate = (new BigNumber(10)).pow(24).add(1);
        await makerDao.setDollarsPerEtherWei(maxRate);

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        await makerDao.setDollarsPerEtherWei(dollarsPerEtherWei);

        rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert(rxRate.valueOf() > 0, "rate should be above zero");
    })

    it("get rate for pair not digix && ether. see returns 0", async function (){
        const block = await web3.eth.blockNumber;

        let rxRate = await digixReserve.getConversionRate(ethAddress, ethAddress, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        rxRate = await digixReserve.getConversionRate(digix.address, digix.address, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        rxRate = await digixReserve.getConversionRate(ethAddress, user2, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert(rxRate.valueOf() > 0, "rate should be above zero");
    })


    it("set maker dao to return high rate so this * 1000 will cause > max rate. see our get rate returns 0", async function (){
        const block = await web3.eth.blockNumber;
        //
        const highRate = (new BigNumber(10)).pow(23);
        await makerDao.setDollarsPerEtherWei(highRate);

        //need to set low ask per 1K digix
        const blockT = 9;
        const nonceT = 256690;
        const askT = 20;
        const bidT = 15;
        const vT = 0x1c;
        const rT = new BigNumber('0x0e1603beab2166e4a1d7d8d522b3884903bf0848fa91ca84943b60c89ad52237');
        const sT = new BigNumber('0x6a030e26b68814d4f903ad64fd94269d6bc185e876c3915f008b01f0c0e2b71d');

        await digixReserve.setPriceFeed(blockT, nonceT, askT, bidT, vT, rT, sT);

        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert.equal(rxRate.valueOf(), 0, "rate should be zero");

        await makerDao.setDollarsPerEtherWei(dollarsPerEtherWei);

        rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, 5, block);
        assert(rxRate.valueOf() > 0, "rate should be above zero");
    })

    it("test for overflow with high bid / ask values", async function (){

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
