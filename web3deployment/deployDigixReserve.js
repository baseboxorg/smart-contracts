var Web3 = require("web3");
var fs = require("fs");
var RLP = require('rlp');
var mainnetGasPrice = 3 * 10**9;

//  url = "https://mainnet.infura.io";
  url = 'https://semi-node.kyber.network';
const contractPath = "../contracts/";
const input = {
  "PermissionGroups.sol" : fs.readFileSync(contractPath + 'PermissionGroups.sol', 'utf8'),
  "ERC20Interface.sol" : fs.readFileSync(contractPath + 'ERC20Interface.sol', 'utf8'),
  "Utils.sol" : fs.readFileSync(contractPath + 'Utils.sol', 'utf8'),
  "KyberReserveInterface.sol" : fs.readFileSync(contractPath + 'KyberReserveInterface.sol', 'utf8'),
  "Withdrawable.sol" : fs.readFileSync(contractPath + 'Withdrawable.sol', 'utf8'),
  "DigixReserve.sol" : fs.readFileSync(contractPath + 'DigixReserve.sol', 'utf8'),
  "ConversionRatesInterface.sol" : fs.readFileSync(contractPath + 'ConversionRatesInterface.sol', 'utf8'),
  "SanityRatesInterface.sol" : fs.readFileSync(contractPath + 'SanityRatesInterface.sol', 'utf8')
};

var web3 = new Web3(new Web3.providers.HttpProvider(url));
var solc = require('solc')

var rand = web3.utils.randomHex(999);
var privateKey = web3.utils.sha3("js sucks" + rand);

var account = web3.eth.accounts.privateKeyToAccount(privateKey);
var sender = account.address;
var nonce;

console.log("from",sender);
console.log("private key");
console.log(privateKey);
//
//let privKeyFile = "./private_" + web3.utils.randomHex(9);
//fs.writeFileSync(privKeyFile, privateKey, function(err) { });

async function sendTx(txObject) {
  var txTo = txObject._parent.options.address;

  var gasLimit;
  try {
    gasLimit = await txObject.estimateGas();
  }
  catch (e) {
    gasLimit = 250 * 1000;
  }

  if(txTo !== null) {
    gasLimit = 250 * 1000;
  }

  //console.log(gasLimit);
  var txData = txObject.encodeABI();
  var txFrom = account.address;
  var txKey = account.privateKey;

  var tx = {
    from : txFrom,
    to : txTo,
    nonce : nonce,
    data : txData,
    gas : gasLimit,
    gasPrice : mainnetGasPrice
  };

  var signedTx = await web3.eth.accounts.signTransaction(tx, txKey);
  nonce++;
  // don't wait for confirmation
  web3.eth.sendSignedTransaction(signedTx.rawTransaction,{from:sender});
}

async function deployContract(solcOutput, contractName, ctorArgs) {

  var actualName = contractName;
  var bytecode = solcOutput.contracts[actualName].bytecode;

  var abi = solcOutput.contracts[actualName].interface;
  var myContract = new web3.eth.Contract(JSON.parse(abi));
  var deploy = myContract.deploy({data:"0x" + bytecode, arguments: ctorArgs});
  var address = "0x" + web3.utils.sha3(RLP.encode([sender,nonce])).slice(12).substring(14);
  address = web3.utils.toChecksumAddress(address);

  await sendTx(deploy);

  myContract.options.address = address;

  return [address,myContract];
}

async function main() {
    nonce = await web3.eth.getTransactionCount(sender);
    console.log("nonce",nonce);

    console.log("starting compilation");
    var output = await solc.compile({ sources: input }, 1);
    console.log(output);
    console.log("finished compilation");

    console.log('privateKey');
    console.log(privateKey);

    await waitForEth();

    let networkStaging = '0xD2D21FdeF0D054D2864ce328cc56D1238d6b239e';
    let digixAddress = '0x4f3AfEC4E5a3F2A6a1A411DEF7D7dFe50eE057bF';
    let makerDaoContract = '0x729D19f657BD0614b4985Cf1D82531c67569197B';

//    let networkProduction = '0x964F35fAe36d75B1e72770e244F6595B68508CF5';

    let admin = '0xd0643bc0d0c879f175556509dbcee9373379d5c3';

    // deploy wrapper
    let digixReserveAdd;
    let digixReserveInst;
    [digixReserveAdd,digixReserveInst] = await deployContract(output, "DigixReserve.sol:DigixReserve",
        [sender, networkStaging, digixAddress]);
//
//    let abiTxt = output.contracts["DigixReserve.sol:DigixReserve"].interface;
//    let abi = JSON.parse(abiTxt);
//    digixReserveInst = await new web3.eth.Contract(abi, digixReserveAdd);

    await sendTx(digixReserveInst.methods.addOperator(admin));
    await sendTx(digixReserveInst.methods.addAlerter(admin));
    await sendTx(digixReserveInst.methods.setMakerDaoContract(makerDaoContract));
    await sendTx(digixReserveInst.methods.setMaxBlockDrift(3000));
    await sendTx(digixReserveInst.methods.transferAdminQuickly(admin));

    console.log("digixReserveAdd", digixReserveAdd);

    console.log("last nonce is", nonce);

    console.log("private key")
    console.log(privateKey);
}


function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function waitForEth() {
  while(true) {
    var balance = await web3.eth.getBalance(sender);
    console.log("waiting for balance to account " + sender);
    if(balance.toString() !== "0") {
      console.log("received " + balance.toString() + " wei");
      return;
    }
    else await sleep(10000)
  }
}



main();
