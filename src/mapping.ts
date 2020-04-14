// The latest Synthetix and event invocations
import { Synthetix as SNX, Transfer as SNXTransferEvent } from '../generated/Synthetix/Synthetix';

import { Synthetix32 } from '../generated/Synthetix/Synthetix32';

import { Synthetix4 } from '../generated/Synthetix/Synthetix4';

import { AddressResolver } from '../generated/Synthetix/AddressResolver';

// SynthetixState has not changed ABI since deployment
import { SynthetixState } from '../generated/Synthetix/SynthetixState';

import { TargetUpdated as TargetUpdatedEvent } from '../generated/ProxySynthetix/Proxy';
import { Vested as VestedEvent, RewardEscrow } from '../generated/RewardEscrow/RewardEscrow';
import {
  Synth,
  Transfer as SynthTransferEvent,
  Issued as IssuedEvent,
  Burned as BurnedEvent,
} from '../generated/SynthsUSD/Synth';
import { FeesClaimed as FeesClaimedEvent } from '../generated/FeePool/FeePool';
import { FeePoolv217 } from '../generated/FeePool/FeePoolv217';

import {
  Synthetix,
  Transfer,
  Issued,
  Burned,
  Issuer,
  ContractUpdated,
  SNXHolder,
  RewardEscrowHolder,
  FeesClaimed,
} from '../generated/schema';

import { BigInt, Address, ethereum, Bytes } from '@graphprotocol/graph-ts';

import { strToBytes } from './common';

import { log } from '@graphprotocol/graph-ts';

let contracts = new Map<string, string>();
contracts.set('escrow', '0x971e78e0c92392a4e39099835cf7e6ab535b2227');
contracts.set('rewardEscrow', '0xb671f2210b1f6621a2607ea63e6b2dc3e2464d1f');

let v219UpgradeBlock = BigInt.fromI32(9518914); // Archernar v2.19.x Feb 20, 2020

// [reference only] Synthetix v2.10.x (bytes4 to bytes32) at txn
// https://etherscan.io/tx/0x612cf929f305af603e165f4cb7602e5fbeed3d2e2ac1162ac61087688a5990b6
let v2100UpgradeBlock = BigInt.fromI32(8622911);

// Synthetix v2.0.0 (rebrand from Havven and adding Multicurrency) at txn
// https://etherscan.io/tx/0x4b5864b1e4fdfe0ab9798de27aef460b124e9039a96d474ed62bd483e10c835a
let v200UpgradeBlock = BigInt.fromI32(6841188); // Dec 7, 2018

// Havven v1.0.1 release at txn
// https://etherscan.io/tx/0x7d5e4d92c702d4863ed71d5c1348e9dec028afd8d165e673d4b6aea75c8b9e2c
let v101UpgradeBlock = BigInt.fromI32(5873222); // June 29, 2018 (nUSDa.1)

// [reference only] Havven v1.0.0 release at txn
// https://etherscan.io/tx/0x1c3b873d0ce0dfafff428fc019bc9f630ac51031fc6021e57fb24c65143d328a
// let v100UpgradeBlock = BigInt.fromI32(5762355); // June 10, 2018 (nUSDa)

// [reference only] ProxySynthetix creation
// https://etherscan.io/tx/0xa733e675705a8af67f4f82df796be763d4f389a45216a89bf5d09f7e7d1aec11
// let proxySynthetixBlock = BigInt.fromI32(5750875); //  June 8, 2018

// [reference only] Havven v0.1.0 (0xf244176246168f24e3187f7288edbca29267739b)
// https://etherscan.io/tx/0x7770e66f2be4f32caa929fe671a5fc4fd134227812f2ef80612395c8f3dade50
// let initialHavvenBlock = BigInt.fromI32(5238336); // Mar 11, 2018 (eUSD)

function getMetadata(): Synthetix {
  let synthetix = Synthetix.load('1');

  if (synthetix == null) {
    synthetix = new Synthetix('1');
    synthetix.issuers = BigInt.fromI32(0);
    synthetix.snxHolders = BigInt.fromI32(0);
    synthetix.save();
  }

  return synthetix as Synthetix;
}

function incrementMetadata(field: string): void {
  let metadata = getMetadata();
  if (field == 'issuers') {
    metadata.issuers = metadata.issuers.plus(BigInt.fromI32(1));
  } else if (field == 'snxHolders') {
    metadata.snxHolders = metadata.snxHolders.plus(BigInt.fromI32(1));
  }
  metadata.save();
}

function decrementMetadata(field: string): void {
  let metadata = getMetadata();
  if (field == 'issuers') {
    metadata.issuers = metadata.issuers.minus(BigInt.fromI32(1));
  } else if (field == 'snxHolders') {
    metadata.snxHolders = metadata.snxHolders.minus(BigInt.fromI32(1));
  }
  metadata.save();
}

function trackIssuer(account: Address): void {
  let existingIssuer = Issuer.load(account.toHex());
  if (existingIssuer == null) {
    incrementMetadata('issuers');
  }
  let issuer = new Issuer(account.toHex());

  issuer.save();
}

function trackSNXHolder(snxContract: Address, account: Address, block: ethereum.Block): void {
  let holder = account.toHex();
  // ignore escrow accounts
  if (contracts.get('escrow') == holder || contracts.get('rewardEscrow') == holder) {
    return;
  }
  let existingSNXHolder = SNXHolder.load(account.toHex());
  let snxHolder = new SNXHolder(account.toHex());
  snxHolder.block = block.number;
  snxHolder.timestamp = block.timestamp;
  if (existingSNXHolder == null && snxHolder.balanceOf > BigInt.fromI32(0)) {
    incrementMetadata('snxHolders');
  } else if (existingSNXHolder != null && snxHolder.balanceOf == BigInt.fromI32(0)) {
    decrementMetadata('snxHolders');
  }
  // // Don't bother trying these extra fields before v2 upgrade (slows down The Graph processing to do all these as try_ calls)
  if (block.number > v219UpgradeBlock) {
    let synthetix = SNX.bind(snxContract);
    snxHolder.balanceOf = synthetix.balanceOf(account);
    snxHolder.collateral = synthetix.collateral(account);

    // Check transferable because it will be null when rates are stale
    let transferableTry = synthetix.try_transferableSynthetix(account);
    if (!transferableTry.reverted) {
      snxHolder.transferable = transferableTry.value;
    }
    let resolverAddress = synthetix.resolver();
    let resolver = AddressResolver.bind(resolverAddress);
    let synthetixState = SynthetixState.bind(resolver.getAddress(strToBytes('SynthetixState', 32)));
    let issuanceData = synthetixState.issuanceData(account);
    snxHolder.initialDebtOwnership = issuanceData.value0;
    snxHolder.debtEntryAtIndex = synthetixState.debtLedger(issuanceData.value1);
  } else if (block.number > v200UpgradeBlock) {
    // Synthetix32 or Synthetix4
    let synthetix = Synthetix32.bind(snxContract);
    // Track all the staking information relevant to this SNX Holder
    snxHolder.balanceOf = synthetix.balanceOf(account);
    snxHolder.collateral = synthetix.collateral(account);
    // Note: Below we try_transferableSynthetix as it uses debtBalanceOf, which eventually calls ExchangeRates.abs
    // It's slower to use try but this protects against instances when Transfers were enabled
    // yet ExchangeRates were stale and throwing errors when calling effectiveValue.
    // E.g. https://etherscan.io/tx/0x5368339311aafeb9f92c5b5d84faa4864c2c3878681a402bbf0aabff60bafa08
    let transferableTry = synthetix.try_transferableSynthetix(account);
    if (!transferableTry.reverted) {
      snxHolder.transferable = transferableTry.value;
    }
    let stateTry = synthetix.try_synthetixState();
    if (!stateTry.reverted) {
      let synthetixStateContract = synthetix.synthetixState();
      let synthetixState = SynthetixState.bind(synthetixStateContract);
      let issuanceData = synthetixState.issuanceData(account);
      snxHolder.initialDebtOwnership = issuanceData.value0;
      snxHolder.debtEntryAtIndex = synthetixState.debtLedger(issuanceData.value1);
    }
  } else if (block.number > v101UpgradeBlock) {
    // When we were Havven, simply track their collateral (SNX balance and escrowed balance)
    let synthetix = Synthetix4.bind(snxContract); // not the correct ABI/contract for pre v2 but should suffice
    snxHolder.balanceOf = synthetix.balanceOf(account);
    let collateralTry = synthetix.try_collateral(account);
    if (!collateralTry.reverted) {
      snxHolder.collateral = collateralTry.value;
    }
  } else {
    let synthetix = Synthetix4.bind(snxContract); // not the correct ABI/contract for pre v2 but should suffice
    snxHolder.balanceOf = synthetix.balanceOf(account);
  }

  snxHolder.save();
}

export function handleTransferSNX(event: SNXTransferEvent): void {
  let entity = new Transfer(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.source = 'SNX';
  entity.from = event.params.from;
  entity.to = event.params.to;
  entity.value = event.params.value;
  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.save();

  trackSNXHolder(event.address, event.params.from, event.block);
  trackSNXHolder(event.address, event.params.to, event.block);
}

export function handleTransferSynth(event: SynthTransferEvent): void {
  let contract = Synth.bind(event.address);
  let entity = new Transfer(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.source = 'sUSD';
  if (event.block.number > v200UpgradeBlock) {
    // sUSD contract didn't have the "currencyKey" field prior to the v2 (multicurrency) release
    let currencyKeyTry = contract.try_currencyKey();
    if (!currencyKeyTry.reverted) {
      entity.source = currencyKeyTry.value.toString();
    }
  }
  entity.from = event.params.from;
  entity.to = event.params.to;
  entity.value = event.params.value;
  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.save();
}

/**
 * Track when underlying contracts change
 */
function contractUpdate(source: string, target: Address, block: ethereum.Block, hash: Bytes): void {
  let entity = new ContractUpdated(hash.toHex());
  entity.source = source;
  entity.target = target;
  entity.block = block.number;
  entity.timestamp = block.timestamp;
  entity.save();
}

export function handleProxyTargetUpdated(event: TargetUpdatedEvent): void {
  contractUpdate('Synthetix', event.params.newTarget, event.block, event.transaction.hash);
}

// export function handleSetExchangeRates(call: SetExchangeRatesCall): void {
//   contractUpdate('ExchangeRates', call.inputs._exchangeRates, call.block, call.transaction.hash);
// }

// export function handleSetFeePool(call: SetFeePoolCall): void {
//   contractUpdate('FeePool', call.inputs._feePool, call.block, call.transaction.hash);
// }

/**
 * Handle reward vest events so that we know which addresses have rewards, and
 * to recalculate SNX Holders staking details.
 */
// Note: we use VestedEvent here even though is also handles VestingEntryCreated (they share the same signature)
export function handleRewardVestEvent(event: VestedEvent): void {
  let entity = new RewardEscrowHolder(event.params.beneficiary.toHex());
  let contract = RewardEscrow.bind(event.address);
  entity.balanceOf = contract.balanceOf(event.params.beneficiary);
  entity.save();
  // now track the SNX holder as this action can impact their collateral
  let synthetixAddress = contract.synthetix();
  trackSNXHolder(synthetixAddress, event.params.beneficiary, event.block);
}

export function handleIssuedSynths(event: IssuedEvent): void {
  // We need to figure out if this was generated from a call to Synthetix.issueSynths, issueMaxSynths or any earlier
  // versions.

  let functions = new Map<string, string>();

  functions.set('0xaf086c7e', 'issueMaxSynths()');
  functions.set('0x320223db', 'issueMaxSynthsOnBehalf(address)');
  functions.set('0x8a290014', 'issueSynths(uint256)');
  functions.set('0xe8e09b8b', 'issueSynthsOnBehalf(address,uint256');

  // Prior to Vega we had the currency key option in issuance
  functions.set('0xef7fae7c', 'issueMaxSynths(bytes32)'); // legacy
  functions.set('0x0ee54a1d', 'issueSynths(bytes32,uint256)'); // legacy

  // Prior to Sirius release, we had currency keys using bytes4
  functions.set('0x9ff8c63f', 'issueMaxSynths(bytes4)'); // legacy
  functions.set('0x49755b9e', 'issueSynths(bytes4,uint256)'); // legacy

  // Prior to v2
  functions.set('0xda5341a8', 'issueMaxNomins()'); // legacy
  functions.set('0x187cba25', 'issueNomins(uint256)'); // legacy

  // so take the first four bytes of input
  let input = event.transaction.input.subarray(0, 4) as Bytes;

  // and for any function calls that don't match our mapping, we ignore them
  if (!functions.has(input.toHexString())) {
    log.debug('Ignoring Issued event with input: {}, hash: {}', [
      event.transaction.input.toHexString(),
      event.transaction.hash.toHex(),
    ]);
    return;
  }

  let entity = new Issued(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.account = event.transaction.from;
  entity.value = event.params.value;

  let synth = Synth.bind(event.address);
  let currencyKeyTry = synth.try_currencyKey();
  if (!currencyKeyTry.reverted) {
    entity.source = currencyKeyTry.value.toString();
  } else {
    entity.source = 'sUSD';
  }

  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  // track this issuer for reference
  trackIssuer(event.transaction.from);

  // update SNX holder details
  trackSNXHolder(event.transaction.to as Address, event.transaction.from, event.block);
}

export function handleBurnedSynths(event: BurnedEvent): void {
  // We need to figure out if this was generated from a call to Synthetix.burnSynths, burnSynthsToTarget or any earlier
  // versions.

  let functions = new Map<string, string>();
  functions.set('0x295da87d', 'burnSynths(uint256)');
  functions.set('0xc2bf3880', 'burnSynthsOnBehalf(address,uint256');
  functions.set('0x9741fb22', 'burnSynthsToTarget()');
  functions.set('0x2c955fa7', 'burnSynthsToTargetOnBehalf(address)');

  // Prior to Vega we had the currency key option in issuance
  functions.set('0xea168b62', 'burnSynths(bytes32,uint256)');

  // Prior to Sirius release, we had currency keys using bytes4
  functions.set('0xaf023335', 'burnSynths(bytes4,uint256)');

  // Prior to v2 (i.e. in Havven times)
  functions.set('0x3253ccdf', 'burnNomins(uint256');

  // so take the first four bytes of input
  let input = event.transaction.input.subarray(0, 4) as Bytes;

  // and for any function calls that don't match our mapping, we ignore them
  if (!functions.has(input.toHexString())) {
    log.debug('Ignoring Burned event with input: {}, hash: {}', [
      event.transaction.input.toHexString(),
      event.transaction.hash.toHex(),
    ]);
    return;
  }

  let entity = new Burned(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.account = event.transaction.from;
  entity.value = event.params.value;

  let synth = Synth.bind(event.address);
  let currencyKeyTry = synth.try_currencyKey();
  if (!currencyKeyTry.reverted) {
    entity.source = currencyKeyTry.value.toString();
  } else {
    entity.source = 'sUSD';
  }

  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  // update SNX holder details
  trackSNXHolder(event.transaction.to as Address, event.transaction.from, event.block);
}

export function handleFeesClaimed(event: FeesClaimedEvent): void {
  let entity = new FeesClaimed(event.transaction.hash.toHex() + '-' + event.logIndex.toString());

  entity.account = event.params.account;
  entity.rewards = event.params.snxRewards;
  if (event.block.number > v219UpgradeBlock) {
    // post Achernar, we had no XDRs, so use the value as sUSD
    entity.value = event.params.sUSDAmount;
  } else {
    // pre Achernar, we had XDRs, so we need to figure out their effective value,
    // and for that we need to get to synthetix, which in pre-Achernar was exposed
    // as a public synthetix property on FeePool
    let feePool = FeePoolv217.bind(event.address);

    if (event.block.number > v2100UpgradeBlock) {
      // use bytes32
      let synthetix = Synthetix32.bind(feePool.synthetix());
      // Note: the event param is called "sUSDAmount" because we are using the latest ABI to handle events
      // from both newer and older invocations. Since the event signature of FeesClaimed hasn't changed between versions,
      // we can reuse it, but accept that the variable naming uses the latest ABI
      let tryEffectiveValue = synthetix.try_effectiveValue(
        strToBytes('XDR', 32),
        event.params.sUSDAmount,
        strToBytes('sUSD', 32),
      );

      if (!tryEffectiveValue.reverted) {
        entity.value = tryEffectiveValue.value;
      } else {
        entity.value = BigInt.fromI32(0); // Note: not sure why this might be happening. Need to investigat
      }
    } else {
      // use bytes4
      let synthetix = Synthetix4.bind(feePool.synthetix());
      entity.value = synthetix.effectiveValue(strToBytes('XDR', 4), event.params.sUSDAmount, strToBytes('sUSD', 4));
    }
  }

  entity.block = event.block.number;
  entity.timestamp = event.block.timestamp;

  entity.save();
}
