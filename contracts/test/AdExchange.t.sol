// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AdExchange} from "../src/AdExchange.sol";

/// @title AdExchange Test Suite
/// @notice Covers every checkpoint listed in contracts/srs.md §8
contract AdExchangeTest is Test {
    AdExchange public exchange;

    address public publisher  = makeAddr("publisher");
    address public bidder1    = makeAddr("bidder1");
    address public bidder2    = makeAddr("bidder2");
    address public stranger   = makeAddr("stranger");

    uint256 public constant SLOT_ID    = 4;
    uint256 public constant FLOOR      = 0.01 ether;
    uint256 public constant BID_1      = 0.015 ether;
    uint256 public constant BID_2      = 0.02 ether;

    string public constant CREATIVE_1 = "https://cdn.example.com/ad-blue.png";
    string public constant CREATIVE_2 = "https://cdn.example.com/ad-red.png";

    function setUp() public {
        exchange = new AdExchange();
        // Fund bidders
        vm.deal(bidder1, 1 ether);
        vm.deal(bidder2, 1 ether);
        vm.deal(stranger, 1 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _registerSlot() internal {
        exchange.registerSlot(SLOT_ID, publisher, FLOOR);
    }

    function _registerAndOpen() internal returns (uint256 auctionId) {
        _registerSlot();
        auctionId = exchange.openAuction(SLOT_ID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §8 Step 1 — registerSlot
    // ─────────────────────────────────────────────────────────────────────────

    function test_RegisterSlot_StoresCorrectData() public {
        _registerSlot();
        AdExchange.Slot memory slot = exchange.getSlot(SLOT_ID);

        assertEq(slot.publisher,  publisher,  "wrong publisher");
        assertEq(slot.floorPrice, FLOOR,      "wrong floorPrice");
        assertEq(slot.currentAuctionId, 0,    "should start with no auction");
        assertTrue(slot.registered,           "should be registered");
    }

    function test_RegisterSlot_RevertsOnDuplicate() public {
        _registerSlot();
        vm.expectRevert("AdExchange: slot already registered");
        exchange.registerSlot(SLOT_ID, publisher, FLOOR);
    }

    function test_RegisterSlot_RevertsOnZeroPublisher() public {
        vm.expectRevert("AdExchange: invalid publisher");
        exchange.registerSlot(SLOT_ID, address(0), FLOOR);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §8 Step 2 — openAuction
    // ─────────────────────────────────────────────────────────────────────────

    function test_OpenAuction_EmitsEvent() public {
        _registerSlot();

        uint256 expectedAuctionId = 1;
        uint256 expectedCloseBlock = block.number + exchange.BID_WINDOW_BLOCKS();

        vm.expectEmit(true, true, false, true);
        emit AdExchange.AuctionOpened(expectedAuctionId, SLOT_ID, FLOOR, expectedCloseBlock);

        exchange.openAuction(SLOT_ID);
    }

    function test_OpenAuction_SetsAuctionData() public {
        _registerSlot();
        uint256 openBlock = block.number;
        uint256 auctionId = exchange.openAuction(SLOT_ID);

        AdExchange.Auction memory a = exchange.getAuction(auctionId);
        assertEq(a.slotId,     SLOT_ID,                              "wrong slotId");
        assertEq(a.openBlock,  openBlock,                            "wrong openBlock");
        assertEq(a.closeBlock, openBlock + exchange.BID_WINDOW_BLOCKS(), "wrong closeBlock");
        assertFalse(a.settled,                                       "should not be settled");
    }

    function test_OpenAuction_RevertsIfSlotUnregistered() public {
        vm.expectRevert("AdExchange: slot not registered");
        exchange.openAuction(99);
    }

    function test_OpenAuction_RevertsIfAlreadyOpen() public {
        _registerAndOpen();
        vm.expectRevert("AdExchange: slot already has an open auction");
        exchange.openAuction(SLOT_ID);
    }

    function test_OpenAuction_AllowsReopenAfterSettle() public {
        uint256 id = _registerAndOpen();
        // Roll past close block and settle
        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS() + 1);
        exchange.settleAuction(id);

        // Should now be able to open again
        uint256 newId = exchange.openAuction(SLOT_ID);
        assertEq(newId, 2, "should be auctionId 2");
    }

    function test_GetSlotCurrentAuction_ReturnsCorrectId() public {
        uint256 id = _registerAndOpen();
        assertEq(exchange.getSlotCurrentAuction(SLOT_ID), id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §8 Step 3 — placeBid
    // ─────────────────────────────────────────────────────────────────────────

    function test_PlaceBid_RejectsBelowFloor() public {
        uint256 auctionId = _registerAndOpen();
        vm.prank(bidder1);
        vm.expectRevert("AdExchange: bid below floor price");
        exchange.placeBid{value: FLOOR}(auctionId, CREATIVE_1); // must be STRICTLY greater
    }

    function test_PlaceBid_RejectsBelowCurrentHighest() public {
        uint256 auctionId = _registerAndOpen();

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        vm.prank(bidder2);
        vm.expectRevert("AdExchange: bid below current highest");
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_2); // same amount, not higher
    }

    function test_PlaceBid_RejectsAfterCloseBlock() public {
        uint256 auctionId = _registerAndOpen();

        // Fast-forward past close block
        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());

        vm.prank(bidder1);
        vm.expectRevert("AdExchange: auction closed");
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);
    }

    function test_PlaceBid_EmitsEvent() public {
        uint256 auctionId = _registerAndOpen();

        vm.expectEmit(true, true, false, true);
        emit AdExchange.BidPlaced(auctionId, bidder1, BID_1, CREATIVE_1);

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);
    }

    function test_PlaceBid_UpdatesHighestBidder() public {
        uint256 auctionId = _registerAndOpen();

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        AdExchange.Auction memory a = exchange.getAuction(auctionId);
        assertEq(a.highestBidder, bidder1);
        assertEq(a.highestBid, BID_1);
        assertEq(a.highestCreativeRef, CREATIVE_1);
    }

    function test_PlaceBid_CreditsOutbidBidder() public {
        uint256 auctionId = _registerAndOpen();

        // bidder1 bids first
        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        // bidder2 outbids
        vm.prank(bidder2);
        exchange.placeBid{value: BID_2}(auctionId, CREATIVE_2);

        // bidder1 should have a pending refund of their original bid
        assertEq(
            exchange.pendingWithdrawals(bidder1),
            BID_1,
            "outbid bidder should have full bid credited"
        );

        // bidder2 should have nothing pending
        assertEq(exchange.pendingWithdrawals(bidder2), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §8 Step 4 — settleAuction + withdraw
    // ─────────────────────────────────────────────────────────────────────────

    function test_Settle_RevertsBeforeCloseBlock() public {
        uint256 auctionId = _registerAndOpen();

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        vm.expectRevert("AdExchange: bid window still open");
        exchange.settleAuction(auctionId);
    }

    function test_Settle_RevertsIfAlreadySettled() public {
        uint256 auctionId = _registerAndOpen();
        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());
        exchange.settleAuction(auctionId); // first settle

        vm.expectRevert("AdExchange: already settled");
        exchange.settleAuction(auctionId); // second settle should revert
    }

    function test_Settle_PaysPublisher() public {
        uint256 auctionId = _registerAndOpen();

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        uint256 publisherBefore = publisher.balance;

        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());
        exchange.settleAuction(auctionId);

        uint256 publisherAfter = publisher.balance;
        assertEq(publisherAfter - publisherBefore, BID_1, "publisher should receive winning bid");
    }

    function test_Settle_SetsWinnerData() public {
        uint256 auctionId = _registerAndOpen();

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());
        exchange.settleAuction(auctionId);

        AdExchange.Auction memory a = exchange.getAuction(auctionId);
        assertTrue(a.settled);
        assertEq(a.winner, bidder1);
        assertEq(a.winningPrice, BID_1);
        assertEq(a.winningCreativeRef, CREATIVE_1);
    }

    function test_Settle_EmitsEvent() public {
        uint256 auctionId = _registerAndOpen();

        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());

        vm.expectEmit(true, true, true, true);
        emit AdExchange.AuctionSettled(auctionId, SLOT_ID, bidder1, BID_1, CREATIVE_1);

        exchange.settleAuction(auctionId);
    }

    function test_Settle_NoBids_SettlesWithNoWinner() public {
        uint256 auctionId = _registerAndOpen();
        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());

        // Should not revert even with no bids
        exchange.settleAuction(auctionId);

        AdExchange.Auction memory a = exchange.getAuction(auctionId);
        assertTrue(a.settled);
        assertEq(a.winner, address(0));
        assertEq(a.winningPrice, 0);
    }

    function test_Withdraw_SendsCreditedBalance() public {
        uint256 auctionId = _registerAndOpen();

        // bidder1 bids first, gets outbid by bidder2
        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        vm.prank(bidder2);
        exchange.placeBid{value: BID_2}(auctionId, CREATIVE_2);

        // Settle
        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());
        exchange.settleAuction(auctionId);

        // bidder1 withdraws their refund
        uint256 balanceBefore = bidder1.balance;

        vm.prank(bidder1);
        exchange.withdraw();

        assertEq(bidder1.balance - balanceBefore, BID_1, "bidder1 should get BID_1 back");
        assertEq(exchange.pendingWithdrawals(bidder1), 0, "pending should be zero after withdraw");
    }

    function test_Withdraw_RevertsIfNothingOwed() public {
        vm.prank(stranger);
        vm.expectRevert("AdExchange: nothing to withdraw");
        exchange.withdraw();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // End-to-end: full open → bid×2 → settle → withdraw cycle
    // ─────────────────────────────────────────────────────────────────────────

    function test_EndToEnd_FullCycle() public {
        // Register
        _registerSlot();

        // Open
        uint256 auctionId = exchange.openAuction(SLOT_ID);
        assertEq(exchange.getSlotCurrentAuction(SLOT_ID), auctionId);

        // Bid 1
        vm.prank(bidder1);
        exchange.placeBid{value: BID_1}(auctionId, CREATIVE_1);

        // Bid 2 (outbids bid 1)
        vm.prank(bidder2);
        exchange.placeBid{value: BID_2}(auctionId, CREATIVE_2);

        assertEq(exchange.pendingWithdrawals(bidder1), BID_1);

        // Roll to close
        vm.roll(block.number + exchange.BID_WINDOW_BLOCKS());

        // Settle
        uint256 publisherBefore = publisher.balance;
        exchange.settleAuction(auctionId);

        AdExchange.Auction memory a = exchange.getAuction(auctionId);
        assertTrue(a.settled);
        assertEq(a.winner, bidder2);
        assertEq(a.winningPrice, BID_2);
        assertEq(a.winningCreativeRef, CREATIVE_2);
        assertEq(publisher.balance - publisherBefore, BID_2);

        // Loser withdraws
        uint256 bidder1Before = bidder1.balance;
        vm.prank(bidder1);
        exchange.withdraw();
        assertEq(bidder1.balance - bidder1Before, BID_1);

        // Re-open the slot for a new auction
        uint256 newAuctionId = exchange.openAuction(SLOT_ID);
        assertEq(newAuctionId, auctionId + 1);
    }
}
