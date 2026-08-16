// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AdExchange} from "../src/AdExchange.sol";

/// @title AdExchange Extended Audit & Invariant Test Suite
contract AdExchangeAuditTest is Test {
    AdExchange public exchange;

    address public publisher1 = makeAddr("publisher1");
    address public publisher2 = makeAddr("publisher2");
    address public bidder1    = makeAddr("bidder1");
    address public bidder2    = makeAddr("bidder2");

    uint256 public constant SLOT_1_ID  = 1;
    uint256 public constant SLOT_2_ID  = 2;
    uint256 public constant FLOOR_1    = 0.01 ether;
    uint256 public constant FLOOR_2    = 0.05 ether;

    function setUp() public {
        exchange = new AdExchange();
        vm.deal(bidder1, 10 ether);
        vm.deal(bidder2, 10 ether);

        exchange.registerSlot(SLOT_1_ID, publisher1, FLOOR_1);
        exchange.registerSlot(SLOT_2_ID, publisher2, FLOOR_2);
    }

    /// @notice Invariant A: Placing a bid must NEVER modify slot.floorPrice
    function test_PlaceBid_DoesNotChangeSlotFloorPrice() public {
        uint256 auctionId = exchange.openAuction(SLOT_1_ID);

        vm.prank(bidder1);
        exchange.placeBid{value: 2 ether}(auctionId, "https://ad.com/banner.png");

        AdExchange.Slot memory slot = exchange.getSlot(SLOT_1_ID);
        assertEq(slot.floorPrice, FLOOR_1, "floorPrice altered after high bid");
    }

    /// @notice Invariant A: Subsequent auction resets min bid requirement back to floorPrice
    function test_SubsequentAuction_ResetsToFloorPrice() public {
        // Auction 1: Bids reach 5 ETH
        uint256 auction1 = exchange.openAuction(SLOT_1_ID);
        vm.prank(bidder1);
        exchange.placeBid{value: 5 ether}(auction1, "https://ad.com/banner1.png");

        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS() + 1);
        exchange.settleAuction(auction1);

        // Auction 2: Open new auction for same slot
        uint256 auction2 = exchange.openAuction(SLOT_1_ID);

        // A bid just above the static FLOOR_1 (0.011 ETH < 5 ETH) MUST succeed
        uint256 lowNewBid = FLOOR_1 + 0.001 ether;
        vm.prank(bidder2);
        exchange.placeBid{value: lowNewBid}(auction2, "https://ad.com/banner2.png");

        AdExchange.Auction memory a2 = exchange.getAuction(auction2);
        assertEq(a2.highestBid, lowNewBid, "new auction failed to reset to floor price");
    }

    /// @notice Invariant B: Concurrent auctions on different slots are completely isolated
    function test_MultipleSlots_IndependentAuctions() public {
        uint256 auction1 = exchange.openAuction(SLOT_1_ID);
        uint256 auction2 = exchange.openAuction(SLOT_2_ID);

        // Bid 10 ETH on Slot 1
        vm.prank(bidder1);
        exchange.placeBid{value: 10 ether}(auction1, "https://ad.com/slot1.png");

        // Slot 2 auction highestBid should remain 0
        AdExchange.Auction memory a2 = exchange.getAuction(auction2);
        assertEq(a2.highestBid, 0, "Slot 2 auction contaminated by Slot 1 bid");

        // Slot 2 accepts bid above FLOOR_2 (0.06 ETH << 10 ETH)
        vm.prank(bidder2);
        exchange.placeBid{value: 0.06 ether}(auction2, "https://ad.com/slot2.png");

        AdExchange.Auction memory a1After = exchange.getAuction(auction1);
        AdExchange.Auction memory a2After = exchange.getAuction(auction2);

        assertEq(a1After.highestBid, 10 ether);
        assertEq(a2After.highestBid, 0.06 ether);
    }

    /// @notice Invariant C: Pull-pattern refund credits previous bidder
    function test_PullRefund_OutbidBidderReceivesCredit() public {
        uint256 auctionId = exchange.openAuction(SLOT_1_ID);

        vm.prank(bidder1);
        exchange.placeBid{value: 1 ether}(auctionId, "https://ad.com/b1.png");

        vm.prank(bidder2);
        exchange.placeBid{value: 2 ether}(auctionId, "https://ad.com/b2.png");

        assertEq(exchange.pendingWithdrawals(bidder1), 1 ether, "outbid credit mismatch");
    }
}
