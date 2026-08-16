// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AdExchange — On-Chain RTB Auction Engine
/// @notice Completely trustless: openAuction and settleAuction are callable by anyone.
///         No admin role, no off-chain state. Frontend reads all auction data directly
///         via getAuction() and getSlotCurrentAuction().
contract AdExchange {
    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Number of blocks the bid window stays open after openAuction().
    /// At ~1s Monad block time this is a ~3-second window.
    uint256 public constant BID_WINDOW_BLOCKS = 3;

    // ─────────────────────────────────────────────────────────────────────────
    // Data model
    // ─────────────────────────────────────────────────────────────────────────

    struct Slot {
        address publisher;
        uint256 floorPrice;
        uint256 currentAuctionId; // 0 means no auction currently open
        bool registered;
    }

    struct Auction {
        uint256 slotId;
        uint256 openBlock;
        uint256 closeBlock;
        bool settled;
        address highestBidder;
        uint256 highestBid;
        string highestCreativeRef;
        // Populated after settle:
        address winner;
        uint256 winningPrice;
        string winningCreativeRef;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev slotId => Slot
    mapping(uint256 => Slot) private _slots;

    /// @dev auctionId => Auction (IDs start at 1)
    mapping(uint256 => Auction) private _auctions;

    /// @dev pull-pattern refund balances: address => wei owed
    mapping(address => uint256) private _pendingWithdrawals;

    /// @dev monotonically increasing auction ID counter
    uint256 private _nextAuctionId = 1;

    // ─────────────────────────────────────────────────────────────────────────
    // Events — field order is stable; Person B's frontend decodes by ABI shape.
    // DO NOT rename or reorder fields after ABI handoff.
    // ─────────────────────────────────────────────────────────────────────────

    event AuctionOpened(
        uint256 indexed auctionId,
        uint256 indexed slotId,
        uint256 floorPrice,
        uint256 closeBlock
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount,
        string creativeRef
    );

    event AuctionSettled(
        uint256 indexed auctionId,
        uint256 indexed slotId,
        address indexed winner,
        uint256 winningPrice,
        string winningCreativeRef
    );

    // ─────────────────────────────────────────────────────────────────────────
    // FR-1: registerSlot
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Registers an ad slot once. Reverts if already registered.
    /// @param slotId       Arbitrary numeric ID chosen by the publisher.
    /// @param publisher    Address that receives auction revenue.
    /// @param floorPrice   Minimum accepted bid in wei.
    function registerSlot(
        uint256 slotId,
        address publisher,
        uint256 floorPrice
    ) external {
        require(!_slots[slotId].registered, "AdExchange: slot already registered");
        require(publisher != address(0), "AdExchange: invalid publisher");

        _slots[slotId] = Slot({
            publisher: publisher,
            floorPrice: floorPrice,
            currentAuctionId: 0,
            registered: true
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FR-2: openAuction
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Opens a new auction for an ad slot. Callable by anyone.
    /// @param slotId The registered slot to auction.
    /// @return auctionId The newly created auction's ID.
    function openAuction(uint256 slotId) external returns (uint256 auctionId) {
        Slot storage slot = _slots[slotId];
        require(slot.registered, "AdExchange: slot not registered");

        // Prevent double-auctioning the same slot
        uint256 existingId = slot.currentAuctionId;
        if (existingId != 0) {
            require(
                _auctions[existingId].settled,
                "AdExchange: slot already has an open auction"
            );
        }

        auctionId = _nextAuctionId++;
        uint256 closeBlock = block.number + BID_WINDOW_BLOCKS;

        _auctions[auctionId] = Auction({
            slotId: slotId,
            openBlock: block.number,
            closeBlock: closeBlock,
            settled: false,
            highestBidder: address(0),
            highestBid: 0,
            highestCreativeRef: "",
            winner: address(0),
            winningPrice: 0,
            winningCreativeRef: ""
        });

        slot.currentAuctionId = auctionId;

        emit AuctionOpened(auctionId, slotId, slot.floorPrice, closeBlock);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FR-3: placeBid
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Place a bid on an open auction. msg.value IS the bid amount.
    /// @param auctionId   The auction to bid on.
    /// @param creativeRef IPFS hash or HTTPS URL of the ad creative image.
    function placeBid(uint256 auctionId, string calldata creativeRef) external payable {
        Auction storage auction = _auctions[auctionId];
        require(auction.openBlock != 0, "AdExchange: auction does not exist");
        require(!auction.settled, "AdExchange: auction already settled");
        require(block.number < auction.closeBlock, "AdExchange: auction closed");

        Slot storage slot = _slots[auction.slotId];
        require(msg.value > slot.floorPrice, "AdExchange: bid below floor price");
        require(msg.value > auction.highestBid, "AdExchange: bid below current highest");

        // Pull-pattern refund: credit the outbid bidder, do NOT push ETH inside here
        // (avoids reentrancy and failed-send footguns)
        if (auction.highestBidder != address(0)) {
            _pendingWithdrawals[auction.highestBidder] += auction.highestBid;
        }

        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;
        auction.highestCreativeRef = creativeRef;

        emit BidPlaced(auctionId, msg.sender, msg.value, creativeRef);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FR-4: settleAuction
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Settles an auction after its bid window closes. Callable by anyone.
    /// @dev First-price auction: winner pays exactly their bid.
    ///      Second-price stretch: uncomment the second-price block below.
    /// @param auctionId The auction to settle.
    function settleAuction(uint256 auctionId) external {
        Auction storage auction = _auctions[auctionId];
        require(auction.openBlock != 0, "AdExchange: auction does not exist");
        require(block.number >= auction.closeBlock, "AdExchange: bid window still open");
        require(!auction.settled, "AdExchange: already settled");

        // Mark settled first (checks-effects-interactions)
        auction.settled = true;

        // If nobody bid, settle with no winner — slot publisher gets nothing, no revert
        if (auction.highestBidder == address(0)) {
            emit AuctionSettled(auctionId, auction.slotId, address(0), 0, "");
            return;
        }

        // ── First-price (default) ────────────────────────────────────────────
        uint256 clearingPrice = auction.highestBid;

        // ── Second-price stretch (uncomment to enable) ───────────────────────
        // uint256 clearingPrice = max(secondHighestBid + 1, _slots[auction.slotId].floorPrice);
        // uint256 winnerRebate = auction.highestBid - clearingPrice;
        // if (winnerRebate > 0) {
        //     _pendingWithdrawals[auction.highestBidder] += winnerRebate;
        // }
        // ─────────────────────────────────────────────────────────────────────

        auction.winner = auction.highestBidder;
        auction.winningPrice = clearingPrice;
        auction.winningCreativeRef = auction.highestCreativeRef;

        // Transfer clearing price to publisher
        address publisher = _slots[auction.slotId].publisher;
        (bool ok, ) = publisher.call{value: clearingPrice}("");
        require(ok, "AdExchange: publisher transfer failed");

        emit AuctionSettled(
            auctionId,
            auction.slotId,
            auction.winner,
            clearingPrice,
            auction.winningCreativeRef
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FR-5: withdraw (pull pattern)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Withdraw any refund credit owed to msg.sender (outbid amounts).
    function withdraw() external {
        uint256 amount = _pendingWithdrawals[msg.sender];
        require(amount > 0, "AdExchange: nothing to withdraw");

        // Checks-effects-interactions: zero before send
        _pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "AdExchange: withdraw transfer failed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FR-6: View helpers (frontend calls these directly via viem readContract)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns full auction state. Frontend polls this every 250ms.
    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        return _auctions[auctionId];
    }

    /// @notice Returns the current open auctionId for a slot.
    ///         Lets the ad tag find "the auction currently open for slot X"
    ///         without needing to know the ID in advance.
    function getSlotCurrentAuction(uint256 slotId) external view returns (uint256) {
        return _slots[slotId].currentAuctionId;
    }

    /// @notice Returns the refund balance owed to an address.
    function pendingWithdrawals(address addr) external view returns (uint256) {
        return _pendingWithdrawals[addr];
    }

    /// @notice Returns slot metadata.
    function getSlot(uint256 slotId) external view returns (Slot memory) {
        return _slots[slotId];
    }
}
