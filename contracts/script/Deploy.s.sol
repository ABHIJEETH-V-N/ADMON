// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AdExchange} from "../src/AdExchange.sol";

/// @title Deploy — AdExchange deployment script for Monad Testnet
/// @notice Usage:
///   Local Anvil:
///     forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast -vvvv
///
///   Monad Testnet:
///     forge script script/Deploy.s.sol \
///       --rpc-url $MONAD_RPC_URL \
///       --private-key $RELAYER_PRIVATE_KEY \
///       --broadcast \
///       --verify \
///       -vvvv
///
///   After deploy, copy the printed address to:
///     web/.env  →  VITE_AD_EXCHANGE_ADDRESS=<address>
contract Deploy is Script {
    // ── Demo slot config ────────────────────────────────────────────────────
    // The publisher address receives all auction revenue.
    // Override by setting PUBLISHER_ADDRESS in your .env before running.
    address public constant DEMO_SLOT_ID    = address(0); // unused, slotId is uint256
    uint256 public constant DEMO_SLOT_NUM   = 4;          // The demo slot used in the ad tag
    uint256 public constant DEMO_FLOOR      = 0.001 ether; // 0.001 MON floor price

    function run() external {
        // Load deployer key from env (set RELAYER_PRIVATE_KEY or use --private-key flag)
        uint256 deployerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        // Publisher receives auction revenue. Defaults to deployer if not set.
        address publisher;
        try vm.envAddress("PUBLISHER_ADDRESS") returns (address p) {
            publisher = p;
        } catch {
            publisher = deployer;
        }

        console.log("=== AdExchange Deploy ===");
        console.log("Deployer:   ", deployer);
        console.log("Publisher:  ", publisher);
        console.log("Chain ID:   ", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. Deploy contract
        AdExchange exchange = new AdExchange();
        console.log("AdExchange deployed at:", address(exchange));

        // 2. Register the demo slot so the ad tag is ready immediately
        exchange.registerSlot(DEMO_SLOT_NUM, publisher, DEMO_FLOOR);
        console.log("Registered demo slot", DEMO_SLOT_NUM, "with floor", DEMO_FLOOR);

        vm.stopBroadcast();

        // ── Handoff instructions ────────────────────────────────────────────
        console.log("");
        console.log("=== Handoff to web/ team ===");
        console.log("1. Copy ABI:   contracts/out/AdExchange.sol/AdExchange.json");
        console.log("   -> extract .abi array -> web/src/lib/adExchangeAbi.ts");
        console.log("2. Set in web/.env:");
        console.log("   VITE_AD_EXCHANGE_ADDRESS=", address(exchange));
        console.log("3. Verify on explorer:");
        console.log("   https://testnet.monadexplorer.com/address/", address(exchange));
    }
}
